#!/usr/bin/env node
/**
 * 自愈构建包装器
 *
 * 背景：本机出现过“构建过程中 node_modules 被掏空”的偶发故障——实测约 237 个包的内容消失，
 * 被删目录的 mtime 落在构建时间窗口内（例如 09:34:49–09:34:52，构建日志同期）。
 * 成因在仓库范围之外（已排除 pnpm 运行前自动安装、npm/npx 改写），因此**构建前的守卫无法预防**。
 * 本包装器的职责是：构建失败后先检测依赖是否被破坏，是则修复并重试一次，否则如实返回失败。
 *
 * 用法：
 *   node scripts/build-with-heal.mjs [--root=<dir>] [-- <传给 next build 的额外参数>]
 *
 * 自测钩子：
 *   MTV_BUILD_CMD_OVERRIDE=<命令>   用该命令替代 `next build`（仅用于验证包装器控制流，
 *                                  例如 Windows 下 `cmd /c exit 7` 模拟失败）
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const getOption = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const rootDir = getOption('--root', process.cwd());
const sepIndex = args.indexOf('--');
const extraArgs = sepIndex >= 0 ? args.slice(sepIndex + 1) : [];

const guardScript = join(rootDir, 'scripts', 'ensure-deps-integrity.mjs');
const nextBin = join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const override = process.env.MTV_BUILD_CMD_OVERRIDE;
const baseEnv = { ...process.env, npm_config_verify_deps_before_run: 'false' };

const log = (msg) => console.log(`[build-heal] ${msg}`);

function runGuard(guardArgs) {
  const result = spawnSync(process.execPath, [guardScript, `--root=${rootDir}`, ...guardArgs], {
    cwd: rootDir,
    stdio: 'inherit',
    env: baseEnv,
  });
  return result.status;
}

function runBuild() {
  if (override) {
    log(`使用 MTV_BUILD_CMD_OVERRIDE 执行：${override}`);
    const result = spawnSync(override, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
      env: baseEnv,
    });
    return result.status;
  }

  if (!existsSync(nextBin)) {
    console.error(`[build-heal] 找不到 next 入口：${nextBin}（依赖可能已被破坏）`);
    return 1;
  }
  const result = spawnSync(process.execPath, [nextBin, 'build', ...extraArgs], {
    cwd: rootDir,
    stdio: 'inherit',
    env: baseEnv,
  });
  return result.status;
}

function main() {
  // 1) 构建前守卫：能修就修，修不好就直接失败并给出明确原因
  const guardStatus = runGuard([]);
  if (guardStatus !== 0) {
    console.error(
      '[build-heal] 依赖完整性守卫判定当前 node_modules 不可用，已中止构建。' +
        '可执行 `pnpm deps:check` 查看详情，或 `pnpm deps:repair` 尝试修复。'
    );
    return guardStatus;
  }

  // 2) 第一次构建
  const firstStatus = runBuild();
  if (firstStatus === 0) return 0;

  // 3) 失败后检测：只有确实被破坏才修复重试，否则如实返回（避免掩盖真实构建错误）
  log(`构建失败（退出码 ${firstStatus}），检查依赖是否在构建过程中被破坏...`);
  const checkStatus = runGuard(['--full', '--check']);
  if (checkStatus === 0) {
    log('依赖树完整，判定为真实构建错误，不重试');
    return firstStatus;
  }

  log('检测到依赖被破坏，开始修复...');
  const repairStatus = runGuard(['--full']);
  if (repairStatus !== 0) {
    console.error('[build-heal] 修复失败，无法重试构建');
    return repairStatus;
  }

  log('依赖已修复，重试构建（仅一次）...');
  const secondStatus = runBuild();
  if (secondStatus === 0) {
    console.warn(
      '[build-heal] ⚠ 构建在自动修复依赖后成功。说明本次失败源于 node_modules 被破坏，' +
        '建议用 `pnpm deps:check` 复查环境稳定性。'
    );
    return 0;
  }

  console.error(`[build-heal] 重试后仍失败（退出码 ${secondStatus}）`);
  return secondStatus;
}

process.exitCode = main();
