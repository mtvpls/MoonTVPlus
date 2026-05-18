import { EpisodeFilterConfig } from './types';

export function normalizeEpisodeFilterConfig(
  config?: EpisodeFilterConfig | null
): EpisodeFilterConfig {
  return {
    rules: config?.rules ?? [],
    reverseMode: config?.reverseMode ?? false,
  };
}

export function doesEpisodeTitleMatchFilterRules(
  title: string,
  config?: EpisodeFilterConfig | null
): boolean {
  const normalizedConfig = normalizeEpisodeFilterConfig(config);

  for (const rule of normalizedConfig.rules) {
    if (!rule.enabled) continue;

    try {
      if (rule.type === 'normal' && title.includes(rule.keyword)) {
        return true;
      }
      if (rule.type === 'regex' && new RegExp(rule.keyword).test(title)) {
        return true;
      }
    } catch (e) {
      console.error('集数过滤规则错误:', e);
    }
  }

  return false;
}

export function isEpisodeHiddenByFilter(
  title: string,
  config?: EpisodeFilterConfig | null
): boolean {
  const normalizedConfig = normalizeEpisodeFilterConfig(config);
  if (normalizedConfig.rules.length === 0) {
    return false;
  }

  const isMatched = doesEpisodeTitleMatchFilterRules(title, normalizedConfig);
  return normalizedConfig.reverseMode ? !isMatched : isMatched;
}
