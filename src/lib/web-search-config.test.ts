import { getWebSearchProvider, resolveWebSearch } from './web-search-config';

describe('web search provider resolution', () => {
  it('uses anonymous Parallel only when enabled and unconfigured', () => {
    expect(resolveWebSearch({})).toBeUndefined();
    expect(
      resolveWebSearch({
        EnableWebSearch: false,
        WebSearchProvider: 'parallel',
      })
    ).toBeUndefined();
    expect(resolveWebSearch({ EnableWebSearch: true })).toEqual({
      provider: 'parallel',
      apiKey: '',
    });
  });
  it('keeps saved providers and deliberately configured credentials', () => {
    expect(getWebSearchProvider({ TavilyApiKey: 'saved' })).toBe('tavily');
    expect(getWebSearchProvider({ SerperApiKey: 'saved' })).toBe('serper');
    expect(getWebSearchProvider({ SerpApiKey: 'saved' })).toBe('serpapi');
    expect(
      resolveWebSearch({
        EnableWebSearch: true,
        WebSearchProvider: 'bing',
        TavilyApiKey: 'saved',
      })
    ).toEqual({ provider: 'bing', apiKey: '' });
    expect(
      resolveWebSearch({
        EnableWebSearch: true,
        WebSearchProvider: 'parallel',
        TavilyApiKey: 'saved',
      })
    ).toEqual({ provider: 'parallel', apiKey: '' });
    expect(
      resolveWebSearch({ EnableWebSearch: true, WebSearchProvider: 'tavily' })
    ).toBeUndefined();
  });
});
