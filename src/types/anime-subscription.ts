export interface AnimeSubscription {
  id: string;
  title: string;
  /**
   * 包含关键词表达式。
   * 支持 &（且）|（或）()；无运算符时逗号为 AND（兼容旧数据）。
   * 例：喵萌奶茶屋&(简日双语|简日内嵌)
   */
  filterText: string;
  /**
   * 排除关键词表达式。
   * 支持 & | ()；无运算符时逗号为 OR（兼容旧数据）。
   * 例：先行|预告|PV
   */
  excludeText?: string;
  source: 'acgrip' | 'mikan' | 'dmhy' | 'nyaa';
  enabled: boolean;
  /**
   * 单集只下载一次：同一集匹配到多个种子时只入队一条（可选，默认 false）
   */
  onePerEpisode?: boolean;
  /**
   * 缺集重新检索：首搜若跳集（如已看到 1，结果只有 11/12），
   * 则对中间缺集按「番名 + 补零集数」再搜（可选，默认 false）
   */
  refillMissingEpisodes?: boolean;
  /**
   * 自定义集数提取正则（可选）。
   * 留空使用内置规则；填写后优先生效，首个捕获组作为集数（无捕获组时取整个匹配）。
   * 例：第(\d{1,3})[话話集]
   */
  episodeRegex?: string;
  /**
   * 覆盖父目录（可选）。
   * 留空用「离线下载目录」；填写后实际保存到「该路径/番剧名」，可用「源名@路径」指定备用源。
   * 例：115@/anime → 115 源的 /anime/番剧名
   */
  downloadPath?: string;
  lastCheckTime: number;
  lastEpisode: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export type AnimeSubscriptionDownloadTool = 'aria2' | 'qBittorrent' | 'Transmission';

/** 集数过滤测试的单条结果 */
export interface EpisodeTestItem {
  title: string;
  episode: number | null;
}

/** 集数过滤测试结果（/api/admin/anime-subscription/test） */
export interface EpisodeTestResult {
  /** 搜索到的种子总数 */
  total: number;
  /** 过滤/排除关键词命中的条数 */
  matched: number;
  /** 测试时使用的当前集数（结果按此计算，不随表单变动） */
  lastEpisode: number;
  /** 提取到的去重集数（升序） */
  episodes: number[];
  /** 大于当前集数（会触发下载）的集数 */
  newEpisodes: number[];
  /** 命中但未能提取集数的条数 */
  unparsed: number;
  /** 命中的种子明细（按集数升序，未解析在最后） */
  items: EpisodeTestItem[];
}

export interface AnimeSubscriptionConfig {
  Enabled: boolean;
  DownloadTool?: AnimeSubscriptionDownloadTool;
  Subscriptions: AnimeSubscription[];
}
