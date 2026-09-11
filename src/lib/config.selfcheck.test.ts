/**
 * configSelfCheck 对特殊源名单的兜底：库里名单为空时从 ConfigFile 补齐。
 * 老库升级上来没有 SpecialSourceApis 字段时，隔离会静默失效，这里守住。
 */

jest.mock('@/lib/db', () => ({ db: {} }));

import { configSelfCheck } from './config';
import type { AdminConfig } from './admin.types';

function makeConfig(overrides: Partial<AdminConfig>): AdminConfig {
  return {
    ConfigFile: '',
    SiteConfig: {} as AdminConfig['SiteConfig'],
    UserConfig: { Users: [] },
    SourceConfig: [
      { key: 'normal', name: '普通源', api: 'https://a.example/api' },
      { key: 'r18a', name: '🔞源A', api: 'https://b.example/api' },
      { key: 'r18b', name: '🔞源B', api: 'https://c.example/api' },
    ],
    CustomCategories: [],
    ...overrides,
  } as AdminConfig;
}

const fileWithSpecial = JSON.stringify({
  special_source_apis: ['r18a', 'r18b', '已删除的源'],
});

describe('configSelfCheck 特殊源名单兜底', () => {
  it('名单缺失时从 ConfigFile 补齐，并丢掉不存在的源', () => {
    const config = configSelfCheck(
      makeConfig({ ConfigFile: fileWithSpecial, SpecialSourceApis: undefined })
    );
    expect((config.SpecialSourceApis ?? []).sort()).toEqual(['r18a', 'r18b']);
  });

  it('名单为空数组时同样补齐', () => {
    const config = configSelfCheck(
      makeConfig({ ConfigFile: fileWithSpecial, SpecialSourceApis: [] })
    );
    expect((config.SpecialSourceApis ?? []).sort()).toEqual(['r18a', 'r18b']);
  });

  it('库里已有名单时不被文件覆盖', () => {
    const config = configSelfCheck(
      makeConfig({ ConfigFile: fileWithSpecial, SpecialSourceApis: ['r18a'] })
    );
    expect(config.SpecialSourceApis).toEqual(['r18a']);
  });

  it('ConfigFile 不是合法 JSON 时保持为空', () => {
    const config = configSelfCheck(
      makeConfig({ ConfigFile: '{坏掉的 json', SpecialSourceApis: [] })
    );
    expect(config.SpecialSourceApis).toEqual([]);
  });
});
