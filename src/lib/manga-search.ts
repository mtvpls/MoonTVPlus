import { MangaChapter, MangaSearchItem } from './manga.types';

export interface MangaSearchGroup {
  key: string;
  items: MangaSearchItem[];
  sourceCount: number;
}

export const mangaSearchItemKey = (item: MangaSearchItem) =>
  `${item.sourceId}+${item.id}`;

export function getSelectedMangaSearchItem(
  group: MangaSearchGroup,
  selectedKey?: string,
  preferredSourceId?: string
): MangaSearchItem {
  return (
    group.items.find((item) => mangaSearchItemKey(item) === selectedKey) ||
    group.items.find((item) => item.sourceId === preferredSourceId) ||
    group.items[0]
  );
}

/** 只忽略标题的排版差异，保留副标题、卷数等内容，避免合并不同作品。 */
export function normalizeMangaSearchTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(
      /[,.!?:;'"()[\]{}<>，。！？：；、·・…—–_‘’“”「」『』【】《》〈〉-]/g,
      ''
    );
}

export function groupMangaSearchResults(
  results: readonly MangaSearchItem[]
): MangaSearchGroup[] {
  const seen = new Set<string>();
  const groups = new Map<
    string,
    { key: string; items: MangaSearchItem[]; sourceIds: Set<string> }
  >();

  for (const item of results) {
    const itemKey = mangaSearchItemKey(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);

    const titleKey = normalizeMangaSearchTitle(item.title);
    const key =
      titleKey && titleKey !== '未命名漫画'
        ? `title:${titleKey}`
        : `item:${itemKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, items: [], sourceIds: new Set() };
      groups.set(key, group);
    }
    // 同源的不同版本也保留，来源数量只计算不同的 sourceId。
    group.items.push(item);
    group.sourceIds.add(item.sourceId);
  }

  return Array.from(groups.values(), (group) => ({
    key: group.key,
    items: group.items,
    sourceCount: group.sourceIds.size,
  }));
}

export function getMangaSearchSourceFilters(
  groups: readonly MangaSearchGroup[]
) {
  const filters = new Map<
    string,
    { sourceId: string; sourceName: string; count: number }
  >();
  for (const group of groups) {
    const seen = new Set<string>();
    for (const item of group.items) {
      if (seen.has(item.sourceId)) continue;
      seen.add(item.sourceId);
      const filter = filters.get(item.sourceId);
      if (filter) {
        filter.count += 1;
      } else {
        filters.set(item.sourceId, {
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          count: 1,
        });
      }
    }
  }
  return Array.from(filters.values());
}

export function sortMangaSearchGroups(
  groups: readonly MangaSearchGroup[],
  query: string
): MangaSearchGroup[] {
  const keyword = normalizeMangaSearchTitle(query);
  const relevance = (group: MangaSearchGroup) => {
    if (!keyword) return 0;
    const title = normalizeMangaSearchTitle(group.items[0].title);
    return title === keyword
      ? 3
      : title.startsWith(keyword)
      ? 2
      : title.includes(keyword)
      ? 1
      : 0;
  };
  return [...groups].sort((a, b) => relevance(b) - relevance(a));
}

/** Suwayomi 的未知话数可能是 -1；这时尝试从章节名读取序号。 */
function chapterNumber(chapter: MangaChapter): number | undefined {
  if (
    typeof chapter.chapterNumber === 'number' &&
    Number.isFinite(chapter.chapterNumber) &&
    chapter.chapterNumber >= 0
  ) {
    return chapter.chapterNumber;
  }
  const match = chapter.name
    .trim()
    .match(
      /^(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:话|話|章|回|集|$)|^(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i
    );
  return match ? Number(match[1] || match[2]) : undefined;
}

export function sortMangaChapters(
  chapters: readonly MangaChapter[]
): MangaChapter[] {
  return chapters
    .map((chapter, index) => ({
      chapter,
      index,
      number: chapterNumber(chapter),
    }))
    .sort((a, b) => {
      if (a.number !== undefined && b.number !== undefined) {
        return a.number - b.number || a.index - b.index;
      }
      if (a.number !== undefined) return -1;
      if (b.number !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ chapter }) => chapter);
}
