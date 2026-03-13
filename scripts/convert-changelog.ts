#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

interface ParsedVersion {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  content: string[];
}

interface OutputVersion {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

function parseChangelog(content: string): { versions: OutputVersion[] } {
  const lines = content.split('\n');
  const versions: ParsedVersion[] = [];
  let currentVersion: ParsedVersion | null = null;
  let currentSection: 'added' | 'changed' | 'fixed' | null = null;
  let inVersionContent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const versionMatch = trimmedLine.match(/^## \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})$/);

    if (versionMatch) {
      if (currentVersion) {
        versions.push(currentVersion);
      }

      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        fixed: [],
        content: [],
      };
      currentSection = null;
      inVersionContent = true;
      continue;
    }

    if (!inVersionContent || !currentVersion) {
      continue;
    }

    if (trimmedLine === '### Added') {
      currentSection = 'added';
      continue;
    }

    if (trimmedLine === '### Changed') {
      currentSection = 'changed';
      continue;
    }

    if (trimmedLine === '### Fixed') {
      currentSection = 'fixed';
      continue;
    }

    if (trimmedLine.startsWith('- ') && currentSection) {
      currentVersion[currentSection].push(trimmedLine.substring(2));
      continue;
    }

    if (trimmedLine && !trimmedLine.startsWith('#') && !trimmedLine.startsWith('###')) {
      currentVersion.content.push(trimmedLine);
    }
  }

  if (currentVersion) {
    versions.push(currentVersion);
  }

  const normalizedVersions = versions.map<OutputVersion>((version) => {
    const hasCategories = version.added.length > 0 || version.changed.length > 0 || version.fixed.length > 0;
    return {
      version: version.version,
      date: version.date,
      added: version.added,
      changed: hasCategories ? version.changed : version.content,
      fixed: version.fixed,
    };
  });

  return { versions: normalizedVersions };
}

function generateTypeScript(changelogData: { versions: OutputVersion[] }): string {
  const entries = changelogData.versions
    .map((version) => {
      const addedEntries = version.added.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
      const changedEntries = version.changed.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
      const fixedEntries = version.fixed.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');

      return `  {
    version: ${JSON.stringify(version.version)},
    date: ${JSON.stringify(version.date)},
    added: [
${addedEntries || '      // 无新增内容'}
    ],
    changed: [
${changedEntries || '      // 无变更内容'}
    ],
    fixed: [
${fixedEntries || '      // 无修复内容'}
    ]
  }`;
    })
    .join(',\n');

  return `// 此文件由 scripts/convert-changelog.ts 自动生成
// 请勿手动编辑

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export const changelog: ChangelogEntry[] = [
${entries}
];

export default changelog;
`;
}

function updateVersionFile(version: string): void {
  const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
  try {
    fs.writeFileSync(versionTxtPath, version, 'utf8');
    console.log(`✅ 已更新 VERSION.txt: ${version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ 无法更新 VERSION.txt:', message);
    process.exit(1);
  }
}

function updateVersionTs(version: string): void {
  const versionTsPath = path.join(process.cwd(), 'src/lib/version.ts');
  try {
    const content = fs.readFileSync(versionTsPath, 'utf8');
    const updatedContent = content.replace(
      /const CURRENT_VERSION = ['"`][^'"`]+['"`];/,
      `const CURRENT_VERSION = '${version}';`
    );

    fs.writeFileSync(versionTsPath, updatedContent, 'utf8');
    console.log(`✅ 已更新 version.ts: ${version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ 无法更新 version.ts:', message);
    process.exit(1);
  }
}

function main(): void {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const outputPath = path.join(process.cwd(), 'src/lib/changelog.ts');

    console.log('正在读取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

    console.log('正在解析 CHANGELOG 内容...');
    const changelogData = parseChangelog(changelogContent);

    if (changelogData.versions.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    const latestVersion = changelogData.versions[0].version;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 TypeScript 文件...');
    const tsContent = generateTypeScript(changelogData);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, tsContent, 'utf-8');

    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log('正在更新版本文件...');
      updateVersionFile(latestVersion);
      updateVersionTs(latestVersion);
    } else {
      console.log('🔧 本地运行模式：跳过版本文件更新');
      console.log('💡 版本文件更新将在 git tag 触发的 release 工作流中完成');
    }

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log('📊 版本统计:');
    changelogData.versions.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length}`
      );
    });

    console.log('\n🎉 转换完成!');
  } catch (error) {
    console.error('❌ 转换失败:', error);
    process.exit(1);
  }
}

main();