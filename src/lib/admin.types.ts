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
  ThemeConfig?: {
    enableBuiltInTheme: boolean; // 是否启用内置主题
    builtInTheme: string; // 内置主题名称
    customCSS: string; // 自定义CSS
    enableCache: boolean; // 是否启用浏览器缓存
    cacheMinutes: number; // 缓存时间（分钟）
    cacheVersion: number; // CSS版本号（用于缓存控制）
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
