export type WebSearchProvider =
  | 'parallel'
  | 'tavily'
  | 'serper'
  | 'serpapi'
  | 'bing';

export interface WebSearchConfig {
  EnableWebSearch?: boolean;
  WebSearchProvider?: WebSearchProvider;
  TavilyApiKey?: string;
  SerperApiKey?: string;
  SerpApiKey?: string;
}

/** Keep explicit choices and existing credentials ahead of the no-key default. */
export function getWebSearchProvider(
  config: WebSearchConfig
): WebSearchProvider {
  return (
    config.WebSearchProvider ??
    (config.TavilyApiKey
      ? 'tavily'
      : config.SerperApiKey
      ? 'serper'
      : config.SerpApiKey
      ? 'serpapi'
      : 'parallel')
  );
}

export function resolveWebSearch(config: WebSearchConfig) {
  if (!config.EnableWebSearch) return undefined;
  const provider = getWebSearchProvider(config);
  const apiKey =
    provider === 'tavily'
      ? config.TavilyApiKey
      : provider === 'serper'
      ? config.SerperApiKey
      : provider === 'serpapi'
      ? config.SerpApiKey
      : '';
  if (provider !== 'parallel' && provider !== 'bing' && !apiKey) {
    return undefined;
  }
  return { provider, apiKey: apiKey || '' };
}
