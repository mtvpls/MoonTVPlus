/**
 * 特殊源双向隔离的核心判定。
 * 服务端 getAvailableApiSites(user, specialOnly) 用同一口径过滤采集源，
 * 这里覆盖客户端侧（收藏 / 播放记录 / URL 传递）的等价逻辑。
 */
import {
  appendSpecialSourceParam,
  filterRecordsBySpecialSourceContext,
  isSpecialSourceContext,
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
