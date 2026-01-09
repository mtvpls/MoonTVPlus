// 弹幕 API 类型定义

// 搜索动漫响应
export interface DanmakuSearchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  animes: DanmakuAnime[];
}

// 动漫信息
export interface DanmakuAnime {
  animeId: number;
  bangumiId?: string;
  animeTitle: string;
  type: string;
  typeDescription: string;
  imageUrl?: string;
  startDate?: string;
  episodeCount?: number;
  rating?: number;
  isFavorited?: boolean;
  source: string;
  links?: DanmakuLink[];
}

// 播放链接
export interface DanmakuLink {
  name: string;
  url: string;
  title: string;
  id: number;
}

// 获取弹幕响应
export interface DanmakuCommentsResponse {
  count: number;
  comments: DanmakuComment[];
}

// 弹幕数据
export interface DanmakuComment {
  p: string; // 弹幕属性: "时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID"
  m: string; // 弹幕内容
  cid: number; // 弹幕ID
}

// 弹幕设置
export interface DanmakuSettings {
  enabled: boolean; // 是否开启弹幕
  opacity: number; // 不透明度 (0-1)
  fontSize: number; // 字体大小
  speed: number; // 弹幕速度 (5-20)
  marginTop: number; // 顶部边距
  marginBottom: number; // 底部边距
  maxlength: number; // 最大弹幕数
  filterRules: string[]; // 过滤规则（正则表达式）
  unlimited: boolean; // 无限弹幕
  synchronousPlayback: boolean; // 同步播放
}

// 自动匹配请求
export interface DanmakuMatchRequest {
  fileName: string;
}

// 自动匹配响应
export interface DanmakuMatchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  isMatched: boolean;
  matches: DanmakuMatch[];
}

// 匹配结果
export interface DanmakuMatch {
  episodeId: number;
  animeId: number;
  animeTitle: string;
  episodeTitle: string;
  type: string;
  typeDescription: string;
  shift: number;
  imageUrl?: string;
}

// 剧集列表响应
export interface DanmakuEpisodesResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  bangumi: DanmakuBangumi;
}

// 番剧信息
export interface DanmakuBangumi {
  bangumiId: string;
  animeTitle: string;
  imageUrl?: string;
  episodes: DanmakuEpisode[];
}

// 剧集信息
export interface DanmakuEpisode {
  episodeId: number;
  episodeTitle: string;
}

// 弹幕选择状态
export interface DanmakuSelection {
  animeId: number;
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  searchKeyword?: string; // 用户搜索时使用的关键词
  danmakuCount?: number; // 弹幕数量
}
