#!/usr/bin/env node
/**
 * 依赖完整性守卫（dependency integrity guard）
 *
 * 背景：本机出现过 node_modules 被“掏空”的情况——`.pnpm/<pkg>@<ver>/node_modules/<name>`
 * 目录还在，但里面的文件（含 package.json）全部消失，只剩空壳。典型症状是构建时报
 *   Error: Cannot find module '...\node_modules\.pnpm\next@...\node_modules\next\dist\...'
 * 成因未确证（已实测排除：本项目的 pnpm 10.14.0 不会在 run 前自动安装；npm/npx 未见改写
 * 记录），因此本脚本不试图消除原因，而是保证再次发生时能自动检测并一键修复。
 *
 * 两级检测（避免每次构建都付出全量扫描的代价）：
 *   1) 快速路径（默认）：只探测 package.json 中直接依赖的 node_modules 入口；
 *      整片掏空（历史两次都是数百个包，含直接依赖）必然命中。
 *   2) 全量路径：遍历 node_modules/.pnpm 下所有包目录（约 3 秒），仅在快速路径发现问题
 *      或使用 --full 时执行；修复动作始终基于全量扫描的结果，确保清理完整。
 *
 * 用法：
 *   node scripts/ensure-deps-integrity.mjs                 # 快速检查，必要时修复
 *   node scripts/ensure-deps-integrity.mjs --full          # 全量检查（再用 --check 可只报告）
 *   node scripts/ensure-deps-integrity.mjs --check         # 只检测（有问题时退出码 1）
 *   node scripts/ensure-deps-integrity.mjs --no-install    # 只删除空壳，不执行 pnpm install
 *   node scripts/ensure-deps-integrity.mjs --root=<dir>    # 指定工程根目录（默认 cwd）
 *   node scripts/ensure-deps-integrity.mjs --verbose       # 打印细节
 *
 * 仅依赖 Node 内置模块，因此在依赖被破坏时仍可运行。
 */

import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getOption = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const rootDir = getOption('--root', process.cwd());
const checkOnly = hasFlag('--check');
const noInstall = hasFlag('--no-install');
const verbose = hasFlag('--verbose');
const forceFull = hasFlag('--full');

const nodeModulesDir = join(rootDir, 'node_modules');
const vstoreDir = join(nodeModulesDir, '.pnpm');

/**
 * 构建链路的关键文件：即使包目录还在、package.json 也在，这些文件缺失同样会让构建失败
 * （实测故障之一就是 `next/dist/compiled/jest-worker/processChild.js` 消失，
 *  而当时 next/package.json 存在，仅靠“目录/package.json 是否存在”的判断会漏掉）
 */
const CRITICAL_FILES = [
  'next/package.json',
  'next/dist/bin/next',
  'next/dist/compiled/jest-worker/processChild.js',
  'next/dist/server/next.js',
  'react/package.json',
  'react/index.js',
  'react/cjs/react.production.min.js',
  'react-dom/package.json',
  'react-dom/index.js',
  'react-dom/cjs/react-dom.production.min.js',
  'typescript/package.json',
  'typescript/lib/tsc.js',
];

/** 读取 package.json 中的直接依赖名（用于快速探测） */
function getDirectDependencyNames() {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    const names = new Set();
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const name of Object.keys(pkg[field] || {})) names.add(name);
    }
    return [...names];
  } catch {
    return null; // 读不到 package.json 时退化为全量扫描
  }
}

/** 快速路径：直接依赖的入口是否完整 */
function findMissingDirectDeps() {
  const names = getDirectDependencyNames();
  if (!names || names.length === 0) return null;

  const missing = [];
  for (const name of names) {
    if (!existsSync(join(nodeModulesDir, name, 'package.json'))) missing.push(name);
    if (verbose && !missing.includes(name)) console.log(`  [ok] ${name}`);
  }
  return missing;
}

/** 关键文件检测：返回缺失的关键文件（相对 node_modules 的路径） */
function findMissingCriticalFiles() {
  const missing = [];
  for (const rel of CRITICAL_FILES) {
    if (!existsSync(join(nodeModulesDir, rel))) {
      missing.push(rel);
      if (verbose) console.log(`  [missing critical] node_modules/${rel}`);
    }
  }
  return missing;
}

/** 把关键文件缺失映射为需要删除重建的包目录（解析 junction 指向的真实目录） */
function resolvePackageDirsForFiles(relFiles) {
  const packageNames = new Set();
  for (const rel of relFiles) {
    const parts = rel.split('/');
    packageNames.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }

  const dirs = [];
  for (const name of packageNames) {
    const link = join(nodeModulesDir, name);
    let target = link;
    try {
      target = realpathSync(link); // 解开 junction/symlink，定位 .pnpm 里的真实目录
    } catch {
      // 链接本身不存在：删除不了，交给 pnpm install 重建
      continue;
    }
    dirs.push({ name, target });
  }
  return dirs;
}

/** 列出某个 .pnpm/<pkg>/node_modules 下的候选包目录（展开 @scope） */
function listPackageDirs(dir) {
  const out = [];
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const child of children) {
    if (child.name.startsWith('.')) continue;
    const childPath = join(dir, child.name);
    if (child.name.startsWith('@')) {
      let scoped;
      try {
        scoped = readdirSync(childPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        if (s.name.startsWith('.')) continue;
        out.push(join(childPath, s.name));
      }
    } else {
      out.push(childPath);
    }
  }
  return out;
}

/** 全量扫描：目录存在但没有 package.json 的包目录 */
function findGuttedPackages() {
  const gutted = [];
  let scanned = 0;

  let entries;
  try {
    entries = readdirSync(vstoreDir, { withFileTypes: true });
  } catch {
    return { gutted, scanned, storePresent: false };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const innerNodeModules = join(vstoreDir, entry.name, 'node_modules');
    if (!existsSync(innerNodeModules)) continue;

    for (const pkgDir of listPackageDirs(innerNodeModules)) {
      let contents;
      try {
        contents = readdirSync(pkgDir);
      } catch {
        continue; // 目录不存在，交给 pnpm 自己重建
      }
      scanned++;
      if (!contents.includes('package.json')) {
        gutted.push(pkgDir);
        if (verbose) console.log(`  [gutted] ${pkgDir}`);
      }
    }
  }

  return { gutted, scanned, storePresent: true };
}

function printList(paths, limit = 10) {
  const rel = paths.map((p) =>
    p.startsWith(rootDir) ? p.replace(rootDir, '').replace(/^[\\/]/, '') : p
  );
  const head = rel.slice(0, limit).map((p) => `  - ${p}`);
  if (rel.length > limit) head.push(`  ... 其余 ${rel.length - limit} 个`);
  return head.join('\n');
}

function repair(targets) {
  const unique = [...new Set(targets)];
  let removed = 0;
  for (const pkgDir of unique) {
    try {
      rmSync(pkgDir, { recursive: true, force: true });
      removed++;
    } catch (error) {
      console.error(`[deps-guard] 删除失败：${pkgDir} :: ${error.message}`);
    }
  }
  console.log(`[deps-guard] 已删除 ${removed}/${unique.length} 个待重建的包目录`);

  if (noInstall) {
    console.log('[deps-guard] --no-install：已跳过安装，请自行执行 pnpm install');
    return;
  }

  console.log('[deps-guard] 正在执行 pnpm install --frozen-lockfile --offline --ignore-scripts ...');
  const result = spawnSync(
    'pnpm',
    ['install', '--frozen-lockfile', '--offline', '--ignore-scripts'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
    }
  );
  if (result.status !== 0) {
    console.error(
      `[deps-guard] pnpm install 退出码 ${result.status}；可手动执行：pnpm install --frozen-lockfile --offline --ignore-scripts`
    );
  }
}

function main() {
  const missingCriticalBefore = findMissingCriticalFiles();
  const missingDirect = forceFull ? null : findMissingDirectDeps();

  // 快速路径：直接依赖入口与关键文件都完整
  if (
    !forceFull &&
    missingDirect !== null &&
    missingDirect.length === 0 &&
    missingCriticalBefore.length === 0
  ) {
    console.log('[deps-guard] ✅ 直接依赖与关键文件完整（快速检查通过）');
    return 0;
  }

  if (missingDirect && missingDirect.length > 0) {
    console.warn(
      `[deps-guard] ⚠ 快速检查发现 ${missingDirect.length} 个直接依赖缺失：${missingDirect.slice(0, 10).join(', ')}${missingDirect.length > 10 ? ' ...' : ''}`
    );
  }
  if (missingCriticalBefore.length > 0) {
    console.warn(
      `[deps-guard] ⚠ 关键文件缺失（局部损坏，package.json 可能仍在）：\n${printList(missingCriticalBefore)}`
    );
  }
  if (missingDirect || missingCriticalBefore.length > 0) {
    console.warn('[deps-guard] 升级为全量扫描以确认损坏范围...');
  }

  const { gutted, scanned, storePresent } = findGuttedPackages();
  if (!storePresent) {
    console.log('[deps-guard] 未发现 node_modules/.pnpm（依赖尚未安装），跳过检查');
    return 0;
  }

  console.log(
    `[deps-guard] 全量扫描完成：检查 ${scanned} 个包目录，发现 ${gutted.length} 个空壳`
  );

  // 需要重建的目标 = 空壳目录 + 关键文件缺失所在的包（解开 junction 定位真实目录）
  const criticalTargets = resolvePackageDirsForFiles(missingCriticalBefore);

  if (gutted.length === 0 && criticalTargets.length === 0) {
    console.log('[deps-guard] ✅ 依赖树完整，无需处理');
    return 0;
  }

  if (gutted.length > 0) {
    console.warn(
      `[deps-guard] ⚠ 检测到 ${gutted.length} 个被掏空的包目录（目录在但 package.json 丢失）：\n${printList(gutted)}`
    );
  }
  if (criticalTargets.length > 0) {
    console.warn(
      `[deps-guard] ⚠ 以下包缺失关键文件，将删除重建：${criticalTargets.map((t) => t.name).join(', ')}`
    );
  }

  if (checkOnly) {
    console.warn('[deps-guard] --check：仅报告，不修改。修复请执行 `pnpm deps:repair`');
    return 1;
  }

  repair([...gutted, ...criticalTargets.map((t) => t.target)]);

  const afterGutted = findGuttedPackages();
  const afterCritical = findMissingCriticalFiles();
  if (afterGutted.gutted.length === 0 && afterCritical.length === 0) {
    console.log(
      `[deps-guard] ✅ 依赖树已恢复（复检 ${afterGutted.scanned} 个包目录、${CRITICAL_FILES.length} 个关键文件，均正常）`
    );
    return 0;
  }

  console.error(
    `[deps-guard] ❌ 仍有问题——空壳 ${afterGutted.gutted.length} 个，关键文件缺失 ${afterCritical.length} 个：\n` +
      `${printList(afterGutted.gutted)}\n${printList(afterCritical)}\n` +
      '  可尝试：删除 node_modules 后执行 pnpm install'
  );
  return 1;
}

process.exitCode = main();
