// 存储进度信息的 Map
const progressStore = new Map<
  string,
  {
    phase: string;
    current: number;
    total: number;
    message: string;
    timestamp: number;
  }
>();

// 清理过期的进度信息（超过5分钟）
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(progressStore.entries());
  for (const [key, value] of entries) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      progressStore.delete(key);
    }
  }
}, 60 * 1000);

// 辅助函数：更新进度
export function updateProgress(
  username: string,
  operation: 'export' | 'import',
  phase: string,
  current: number,
  total: number,
  message: string,
) {
  const progressKey = `${username}:${operation}`;
  progressStore.set(progressKey, {
    phase,
    current,
    total,
    message,
    timestamp: Date.now(),
  });
}

// 辅助函数：清除进度
export function clearProgress(
  username: string,
  operation: 'export' | 'import',
) {
  const progressKey = `${username}:${operation}`;
  progressStore.delete(progressKey);
}

// 辅助函数：获取进度
export function getProgress(username: string, operation: 'export' | 'import') {
  const progressKey = `${username}:${operation}`;
  return progressStore.get(progressKey);
}
