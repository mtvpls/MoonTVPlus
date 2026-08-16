import {
  calculateSeekTime,
  DEFAULT_QUICK_FORWARD_SECONDS,
  DEFAULT_SEEK_STEP_SECONDS,
  loadStoredSeconds,
  normalizeStoredSeconds,
  QUICK_FORWARD_STORAGE_KEY,
  SEEK_STEP_STORAGE_KEY,
} from './player-seek-settings';

describe('播放器两个跳转时间设置', () => {
  beforeEach(() => localStorage.clear());

  it('使用不同的键和默认值', () => {
    expect(QUICK_FORWARD_STORAGE_KEY).toBe('quickForwardSeconds');
    expect(SEEK_STEP_STORAGE_KEY).toBe('seekStepSeconds');
    expect(DEFAULT_QUICK_FORWARD_SECONDS).toBe(90);
    expect(DEFAULT_SEEK_STEP_SECONDS).toBe(10);
    expect(QUICK_FORWARD_STORAGE_KEY).not.toBe(SEEK_STEP_STORAGE_KEY);
  });

  it('分别读取两个键，缺失或非法值回退到各自默认值', () => {
    expect(loadStoredSeconds(QUICK_FORWARD_STORAGE_KEY, 90)).toBe(90);
    expect(loadStoredSeconds(SEEK_STEP_STORAGE_KEY, 10)).toBe(10);

    localStorage.setItem(QUICK_FORWARD_STORAGE_KEY, '45');
    localStorage.setItem(SEEK_STEP_STORAGE_KEY, 'bad');

    expect(loadStoredSeconds(QUICK_FORWARD_STORAGE_KEY, 90)).toBe(45);
    expect(loadStoredSeconds(SEEK_STEP_STORAGE_KEY, 10)).toBe(10);
  });

  it('只接受大于 0 的有限秒数并四舍五入', () => {
    expect(normalizeStoredSeconds(12.6)).toBe(13);
    expect(normalizeStoredSeconds(1)).toBe(1);
    expect(normalizeStoredSeconds(0)).toBeNull();
    expect(normalizeStoredSeconds(-1)).toBeNull();
    expect(normalizeStoredSeconds(Number.NaN)).toBeNull();
    expect(normalizeStoredSeconds(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('按方向计算并把结果限制在视频范围内', () => {
    expect(calculateSeekTime(30, 100, -1, 10)).toBe(20);
    expect(calculateSeekTime(5, 100, -1, 10)).toBe(0);
    expect(calculateSeekTime(95, 100, 1, 10)).toBe(100);
  });
});
