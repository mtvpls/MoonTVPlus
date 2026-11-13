/* HLS 去广告（客户端侧）—— /play 和 /duanju/play 共用这一份：
   浏览器直连源站拉 m3u8，用自定义 hls.js loader 在响应里过滤广告分段。
   两个页面都从这里拿 filterAdsFromM3U8 / createAdFilteringHlsLoader /
   loadCustomAdFilterCode，别再各自复制一份。改过滤规则只改这里。 */

const AD_KEYWORDS = [
  'sponsor',
  '/ad/',
  '/ads/',
  'advert',
  'advertisement',
  '/adjump',
  'redtraffic',
];

export function filterAdsFromM3U8(
  type: string,
  m3u8Content: string,
  customCode?: string
): string {
  // 自定义去广告代码优先（管理员在后台配的，按源区分）
  if (customCode && customCode.trim()) {
    try {
      // 去掉 TypeScript 类型注解，当纯 JS 执行
      const jsCode = customCode
        .replace(
          /(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g,
          '$1$3'
        )
        .replace(
          /\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g,
          ') {'
        )
        .replace(
          /(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g,
          '$1 $2 ='
        );
      const customFunction = new Function(
        'type',
        'm3u8Content',
        jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
      );
      return customFunction(type, m3u8Content);
    } catch (err) {
      console.error('执行自定义去广告代码失败，使用默认规则:', err);
    }
  }

  // 默认规则：按关键字丢广告分段
  if (!m3u8Content) return '';

  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // #EXT-X-DISCONTINUITY 直接去掉
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      i++;
      continue;
    }

    // #EXTINF 下一行是分段地址，命中广告关键字就把两行一起丢
    if (line.includes('#EXTINF:')) {
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const containsAdKeyword = AD_KEYWORDS.some((keyword) =>
          nextLine.toLowerCase().includes(keyword.toLowerCase())
        );
        if (containsAdKeyword) {
          i += 2;
          continue;
        }
      }
    }

    filteredLines.push(line);
    i++;
  }

  return filteredLines.join('\n');
}

/**
 * 生成去广告用的 hls.js loader 类。getSource/getCustomCode 用闭包传，
 * 这样 loader 每次请求都能拿到最新的源名和自定义规则。
 * 返回类型写成 any：HlsLib 是动态 import 的，基类拿不到类型，
 * 硬标成 hls.js 的 Loader 会因为缺成员而编译不过。
 */
export function createAdFilteringHlsLoader(
  HlsLib: any,
  getSource: () => string,
  getCustomCode: () => string
): any {
  return class CustomHlsJsLoader extends HlsLib.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 只拦 manifest 和 level，分片本身不需要处理
        if (context?.type === 'manifest' || context?.type === 'level') {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            ctx: any,
            networkDetails: any
          ) {
            if (response.data && typeof response.data === 'string') {
              response.data = filterAdsFromM3U8(
                getSource(),
                response.data,
                getCustomCode()
              );
            }
            return onSuccess(response, stats, ctx, networkDetails);
          };
        }
        load(context, config, callbacks);
      };
    }
  };
}

/**
 * 取后台配置的自定义去广告代码（带 localStorage 缓存 + 版本号校验）。
 * 取不到就返回空串，走默认关键字规则。
 */
export async function loadCustomAdFilterCode(): Promise<string> {
  if (typeof window === 'undefined') return '';
  try {
    const cachedCode = localStorage.getItem('custom_ad_filter_code_cache');
    const cachedVersion = localStorage.getItem('custom_ad_filter_version_cache');
    const version =
      (window as any).RUNTIME_CONFIG?.CUSTOM_AD_FILTER_VERSION || 0;

    // 版本 0 = 后台没配，清缓存跳过
    if (version === 0) {
      localStorage.removeItem('custom_ad_filter_code_cache');
      localStorage.removeItem('custom_ad_filter_version_cache');
      return '';
    }

    if (cachedCode && cachedVersion && parseInt(cachedVersion) === version) {
      return cachedCode;
    }

    const res = await fetch('/api/ad-filter?full=true');
    if (!res.ok) return cachedCode || '';
    const { code } = await res.json();
    if (code) {
      localStorage.setItem('custom_ad_filter_code_cache', code);
      localStorage.setItem('custom_ad_filter_version_cache', version.toString());
      return code;
    }
    return cachedCode || '';
  } catch {
    return '';
  }
}
