// Token 配置常量
// 这个文件不依赖任何服务端模块，可以在客户端安全使用

export const TOKEN_CONFIG = {
  ACCESS_TOKEN_AGE: 4 * 60 * 60 * 1000, // 4 小时
  REFRESH_TOKEN_AGE: 60 * 24 * 60 * 60 * 1000, // 60 天
  RENEWAL_THRESHOLD: 10 * 60 * 1000, // 剩余 10 分钟时自动续期
};
