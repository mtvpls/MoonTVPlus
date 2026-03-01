export interface AdminConfig {
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
    // 弹幕配置
    DanmakuApiBase: string;
    DanmakuApiToken: string;
    // TMDB配置
    TMDBApiKey?: string;
    TMDBProxy?: string;
    TMDBReverseProxy?: string;
    BannerDataSource?: string; // 轮播图数据源：TMDB、TX 或 Douban
    RecommendationDataSource?: string; // 更多推荐数据源：Douban、TMDB、Mixed、MixedSmart
    // Pansou配置
    PansouApiUrl?: string;
    PansouUsername?: string;
    PansouPassword?: string;
    PansouKeywordBlocklist?: string;
    // 评论功能开关
    EnableComments: boolean;
    // 自定义去广告代码
    CustomAdFilterCode?: string;
    CustomAdFilterVersion?: number; // 代码版本号（时间戳）
    // 注册相关配置
    EnableRegistration?: boolean; // 开启注册
    RegistrationRequireTurnstile?: boolean; // 注册启用Cloudflare Turnstile
    LoginRequireTurnstile?: boolean; // 登录启用Cloudflare Turnstile
    TurnstileSiteKey?: string; // Cloudflare Turnstile Site Key
    TurnstileSecretKey?: string; // Cloudflare Turnstile Secret Key
    DefaultUserTags?: string[]; // 新注册用户的默认用户组
    // 求片功能配置
    EnableMovieRequest?: boolean; // 启用求片功能
    MovieRequestCooldown?: number; // 求片冷却时间（秒），默认3600
    // OIDC配置
    EnableOIDCLogin?: boolean; // 启用OIDC登录
    EnableOIDCRegistration?: boolean; // 启用OIDC注册
    OIDCIssuer?: string; // OIDC Issuer URL (用于自动发现)
    OIDCAuthorizationEndpoint?: string; // 授权端点
    OIDCTokenEndpoint?: string; // Token端点
    OIDCUserInfoEndpoint?: string; // 用户信息端点
    OIDCClientId?: string; // OIDC Client ID
    OIDCClientSecret?: string; // OIDC Client Secret
    OIDCButtonText?: string; // OIDC登录按钮文字
    OIDCMinTrustLevel?: number; // 最低信任等级（仅LinuxDo网站有效，为0时不判断）
  };
  UserConfig: {
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[]; // 优先级高于tags限制
      tags?: string[]; // 多 tags 取并集限制
    }[];
    Tags?: {
      name: string;
      enabledApis: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
    proxyMode?: boolean; // 代理模式开关：启用后由服务器代理m3u8和ts分片
    weight?: number; // 权重：用于排序和优选评分，默认0，范围0-100
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  LiveConfig?: {
    key: string;
    name: string;
    url: string;  // m3u 地址
    ua?: string;
    epg?: string; // 节目单
    from: 'config' | 'custom';
    channelNumber?: number;
    disabled?: boolean;
  }[];
  WebLiveConfig?: {
    key: string;
    name: string;
    platform: string; // 直播平台类型，如 'huya'
    roomId: string; // 房间ID
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  WebLiveEnabled?: boolean; // 网络直播功能总开关
  ThemeConfig?: {
    enableBuiltInTheme: boolean; // 是否启用内置主题
    builtInTheme: string; // 内置主题名称
    customCSS: string; // 自定义CSS
    enableCache: boolean; // 是否启用浏览器缓存
    cacheMinutes: number; // 缓存时间（分钟）
    cacheVersion: number; // CSS版本号（用于缓存控制）
    loginBackgroundImage?: string; // 登录界面背景图
    registerBackgroundImage?: string; // 注册界面背景图
    // 进度条图标配置
    progressThumbType?: 'default' | 'preset' | 'custom'; // 图标类型
    progressThumbPresetId?: string; // 预制图标ID
    progressThumbCustomUrl?: string; // 自定义图标URL
  };
  OpenListConfig?: {
    Enabled: boolean; // 是否启用私人影库功能
    URL: string; // OpenList 服务器地址
    Username: string; // 账号（用于登录获取Token）
    Password: string; // 密码（用于登录获取Token）
    RootPath?: string; // 旧字段：根目录路径（向后兼容，迁移后删除）
    RootPaths?: string[]; // 新字段：多根目录路径列表
    OfflineDownloadPath: string; // 离线下载目录，默认 "/"
    LastRefreshTime?: number; // 上次刷新时间戳
    ResourceCount?: number; // 资源数量
    ScanInterval?: number; // 定时扫描间隔（分钟），0表示关闭，最低60分钟
    ScanMode?: 'torrent' | 'name' | 'hybrid'; // 扫描模式：torrent=种子库匹配，name=名字匹配，hybrid=混合模式（默认）
    DisableVideoPreview?: boolean; // 禁用预览视频，直接返回直连链接
  };
  AIConfig?: {
    Enabled: boolean; // 是否启用AI问片功能
    Provider: 'openai' | 'claude' | 'custom'; // AI服务提供商
    // OpenAI配置
    OpenAIApiKey?: string;
    OpenAIBaseURL?: string; // 自定义API地址（如Azure、国内代理等）
    OpenAIModel?: string; // 模型名称，如gpt-4, gpt-3.5-turbo
    // Claude配置
    ClaudeApiKey?: string;
    ClaudeModel?: string; // 模型名称，如claude-3-opus-20240229
    // 自定义配置（兼容OpenAI格式的API）
    CustomApiKey?: string;
    CustomBaseURL?: string;
    CustomModel?: string;
    // 决策模型配置
    EnableDecisionModel: boolean; // 是否启用决策模型（用AI判断是否需要联网/数据源）
    DecisionProvider?: 'openai' | 'claude' | 'custom'; // 决策模型提供商
    DecisionOpenAIApiKey?: string;
    DecisionOpenAIBaseURL?: string;
    DecisionOpenAIModel?: string;
    DecisionClaudeApiKey?: string;
    DecisionClaudeModel?: string;
    DecisionCustomApiKey?: string;
    DecisionCustomBaseURL?: string;
    DecisionCustomModel?: string;
    // 联网搜索配置
    EnableWebSearch: boolean; // 是否启用联网搜索
    WebSearchProvider?: 'tavily' | 'serper' | 'serpapi'; // 搜索服务提供商
    TavilyApiKey?: string; // Tavily API密钥
    SerperApiKey?: string; // Serper.dev API密钥
    SerpApiKey?: string; // SerpAPI密钥
    // 功能开关
    EnableHomepageEntry: boolean; // 首页入口开关
    EnableVideoCardEntry: boolean; // VideoCard入口开关
    EnablePlayPageEntry: boolean; // 播放页入口开关
    // 权限控制
    AllowRegularUsers: boolean; // 是否允许普通用户使用AI问片（关闭后仅站长和管理员可用）
    // 高级设置
    Temperature?: number; // AI温度参数（0-2），默认0.7
    MaxTokens?: number; // 最大回复token数，默认1000
    SystemPrompt?: string; // 自定义系统提示词
    EnableStreaming?: boolean; // 是否启用流式响应，默认true
    // AI问片默认消息配置
    DefaultMessageNoVideo?: string; // 无视频时的默认消息
    DefaultMessageWithVideo?: string; // 有视频时的默认消息（支持 {title} 替换符）
  };
  EmbyConfig?: {
    // 新格式：多源配置（推荐）
    Sources?: Array<{
      key: string; // 唯一标识，如 'emby1', 'emby2'
      name: string; // 显示名称，如 '家庭Emby', '公司Emby'
      enabled: boolean; // 是否启用
      ServerURL: string; // Emby服务器地址
      ApiKey?: string; // API Key（推荐方式）
      Username?: string; // 用户名（或使用API Key）
      Password?: string; // 密码
      UserId?: string; // 用户ID（登录后获取）
      AuthToken?: string; // 认证令牌（用户名密码登录后获取）
      Libraries?: string[]; // 要显示的媒体库ID（可选，默认全部）
      LastSyncTime?: number; // 最后同步时间戳
      ItemCount?: number; // 媒体项数量
      isDefault?: boolean; // 是否为默认源（用于向后兼容）
      // 高级流媒体选项
      removeEmbyPrefix?: boolean; // 播放链接移除/emby前缀
      appendMediaSourceId?: boolean; // 拼接MediaSourceId参数
      transcodeMp4?: boolean; // 转码mp4
      proxyPlay?: boolean; // 视频播放代理开关
    }>;
    // 旧格式：单源配置（向后兼容）
    Enabled?: boolean;
    ServerURL?: string;
    ApiKey?: string;
    Username?: string;
    Password?: string;
    UserId?: string;
    AuthToken?: string;
    Libraries?: string[];
    LastSyncTime?: number;
    ItemCount?: number;
  };
  XiaoyaConfig?: {
    Enabled: boolean; // 是否启用
    ServerURL: string; // Alist 服务器地址
    Token?: string; // Token 认证（推荐）
    Username?: string; // 用户名认证（备选）
    Password?: string; // 密码认证（备选）
    DisableVideoPreview?: boolean; // 禁用预览视频，直接返回直连链接
  };
  EmailConfig?: {
    enabled: boolean; // 是否启用邮件通知
    provider: 'smtp' | 'resend'; // 邮件发送方式
    // SMTP配置
    smtp?: {
      host: string; // SMTP服务器地址
      port: number; // SMTP端口（25/465/587）
      secure: boolean; // 是否使用SSL/TLS
      user: string; // SMTP用户名
      password: string; // SMTP密码
      from: string; // 发件人邮箱
    };
    // Resend配置
    resend?: {
      apiKey: string; // Resend API Key
      from: string; // 发件人邮箱
    };
  };
  MusicConfig?: {
    // TuneHub音乐配置
    TuneHubEnabled?: boolean; // 启用音乐功能
    TuneHubBaseUrl?: string; // TuneHub API地址
    TuneHubApiKey?: string; // TuneHub API Key
    // OpenList缓存配置
    OpenListCacheEnabled?: boolean; // 启用OpenList缓存
    OpenListCacheURL?: string; // OpenList服务器地址
    OpenListCacheUsername?: string; // OpenList用户名
    OpenListCachePassword?: string; // OpenList密码
    OpenListCachePath?: string; // OpenList缓存目录路径
    OpenListCacheProxyEnabled?: boolean; // 启用缓存代理返回（默认开启）
  };
  AnimeSubscriptionConfig?: {
    Enabled: boolean; // 是否启用追番功能
    Subscriptions: Array<{
      id: string;
      title: string;
      filterText: string;
      source: 'acgrip' | 'mikan' | 'dmhy';
      enabled: boolean;
      lastCheckTime: number;
      lastEpisode: number;
      createdAt: number;
      updatedAt: number;
      createdBy: string;
    }>;
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
