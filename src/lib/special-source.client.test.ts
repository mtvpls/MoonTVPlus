/**
 * 特殊源双向隔离的核心判定。
 * 服务端 getAvailableApiSites(user, specialOnly) 用同一口径过滤采集源，
 * 这里覆盖客户端侧（收藏 / 播放记录 / URL 传递）的等价逻辑。
 */
import {
  appendSpecialSourceParam,
  filterRecordsBySpecialSourceContext,
  getSpecialSourcePathOnDevice,
  isSpecialSourceContext,
  isSpecialSourceEnabledOnDevice,
  normalizeSpecialSourcePath,
  setSpecialSourceEnabledOnDevice,
  setSpecialSourcePathOnDevice,
  SPECIAL_SOURCE_COOKIE,
  SPECIAL_SOURCE_PATH_COOKIE,
} from './special-source.client';

type WindowWithRuntimeConfig = Window & {
  RUNTIME_CONFIG?: { SPECIAL_SOURCE_APIS?: string[] };
};

const gotoPath = (path: string) => window.history.replaceState({}, '', path);

const setSpecialSourceApis = (apis: string[]) => {
  (window as WindowWithRuntimeConfig).RUNTIME_CONFIG = {
    SPECIAL_SOURCE_APIS: apis,
  };
};

const RECORDS = {
  'r18src+1': { title: '特殊' },
  'normalsrc+2': { title: '普通' },
};

describe('特殊源上下文判定', () => {
  beforeEach(() => setSpecialSourceApis(['r18src']));

  it('/r18 及其子路径算特殊源上下文', () => {
    gotoPath('/r18');
    expect(isSpecialSourceContext()).toBe(true);
    gotoPath('/r18/whatever');
    expect(isSpecialSourceContext()).toBe(true);
  });

  it('普通路径不算，带 special=1 的跳转页算', () => {
    gotoPath('/search?q=abc');
    expect(isSpecialSourceContext()).toBe(false);
    gotoPath('/play?source=r18src&id=1&special=1');
    expect(isSpecialSourceContext()).toBe(true);
  });

  it('appendSpecialSourceParam 只在特殊源上下文追加且不重复', () => {
    gotoPath('/search');
    expect(appendSpecialSourceParam('/play?source=a&id=1')).toBe(
      '/play?source=a&id=1'
    );
    gotoPath('/r18');
    expect(appendSpecialSourceParam('/play?source=a&id=1')).toBe(
      '/play?source=a&id=1&special=1'
    );
    expect(appendSpecialSourceParam('/play?id=1&special=1')).toBe(
      '/play?id=1&special=1'
    );
  });
});

describe('本机特殊源开关（cookie）', () => {
  beforeEach(() => setSpecialSourceEnabledOnDevice(false));

  it('默认关闭；打开写入 cookie，关闭后清掉', () => {
    expect(isSpecialSourceEnabledOnDevice()).toBe(false);

    setSpecialSourceEnabledOnDevice(true);
    // /r18 的服务端渲染靠这个 cookie 判定，名字和值都不能变
    expect(document.cookie).toContain(`${SPECIAL_SOURCE_COOKIE}=1`);
    expect(isSpecialSourceEnabledOnDevice()).toBe(true);

    setSpecialSourceEnabledOnDevice(false);
    expect(isSpecialSourceEnabledOnDevice()).toBe(false);
  });

  it('和其它 cookie 共存时也能认出来', () => {
    document.cookie = 'auth=whatever; path=/';
    setSpecialSourceEnabledOnDevice(true);
    expect(isSpecialSourceEnabledOnDevice()).toBe(true);
  });

  it('开关与入口上下文互不影响：开着开关，普通路径仍是普通入口', () => {
    setSpecialSourceEnabledOnDevice(true);
    gotoPath('/search?q=abc');
    expect(isSpecialSourceContext()).toBe(false);
  });
});

describe('收藏 / 播放记录按入口隔离', () => {
  beforeEach(() => setSpecialSourceApis(['r18src']));

  it('普通入口只出普通源的记录', () => {
    gotoPath('/');
    expect(Object.keys(filterRecordsBySpecialSourceContext(RECORDS))).toEqual([
      'normalsrc+2',
    ]);
  });

  it('/r18 只出特殊源的记录', () => {
    gotoPath('/r18');
    expect(Object.keys(filterRecordsBySpecialSourceContext(RECORDS))).toEqual([
      'r18src+1',
    ]);
  });

  it('没有配置特殊源时，普通入口全给、/r18 为空', () => {
    setSpecialSourceApis([]);
    gotoPath('/');
    expect(filterRecordsBySpecialSourceContext(RECORDS)).toEqual(RECORDS);
    gotoPath('/r18');
    expect(filterRecordsBySpecialSourceContext(RECORDS)).toEqual({});
  });
});

describe('自定义特殊源入口路径', () => {
  it('规范化：补前导斜杠、去尾斜杠、去 query', () => {
    expect(normalizeSpecialSourcePath('anime')).toBe('/anime');
    expect(normalizeSpecialSourcePath('/anime/')).toBe('/anime');
    expect(normalizeSpecialSourcePath('  /anime?x=1 ')).toBe('/anime');
  });

  it('拒绝空串、非法字符、以及撞上真实路由的路径', () => {
    expect(normalizeSpecialSourcePath('')).toBeNull();
    expect(normalizeSpecialSourcePath('/')).toBeNull();
    expect(normalizeSpecialSourcePath('/a b')).toBeNull();
    expect(normalizeSpecialSourcePath('/中文')).toBeNull();
    // 撞上现有顶层路由（按首段）一律拒绝，避免顶掉真实页面
    expect(normalizeSpecialSourcePath('/search')).toBeNull();
    expect(normalizeSpecialSourcePath('/admin')).toBeNull();
    expect(normalizeSpecialSourcePath('/r18')).toBeNull();
    expect(normalizeSpecialSourcePath('/tv/foo')).toBeNull();
  });

  it('cookie 读写不编码，可与 middleware 直接比对 pathname', () => {
    setSpecialSourcePathOnDevice('/anime');
    expect(document.cookie).toContain(`${SPECIAL_SOURCE_PATH_COOKIE}=/anime`);
    expect(getSpecialSourcePathOnDevice()).toBe('/anime');

    setSpecialSourcePathOnDevice('');
    expect(getSpecialSourcePathOnDevice()).toBe('');
  });
});
