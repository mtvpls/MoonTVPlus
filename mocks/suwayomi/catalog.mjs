export class MockError extends Error {
  constructor(message, code = 'BAD_USER_INPUT') {
    super(message);
    this.code = code;
  }
}

export const sources = [
  { id: '1', name: '漫画之家', displayName: '漫画之家', lang: 'zh' },
  { id: '2', name: '如漫画', displayName: '如漫画', lang: 'zh' },
  { id: '3', name: '读漫屋', displayName: '读漫屋', lang: 'zh' },
  { id: '4', name: '漫画柜', displayName: '漫画柜', lang: 'zh' },
  { id: '5', name: '漫画台', displayName: '漫画台', lang: 'zh' },
];

const works = [
  {
    title: '我怎么可能成为你的恋人，不行不行！（※不是不可能！？）',
    author: 'みかみてれん',
    count: 108,
    genre: '校园,恋爱',
    description:
      '新学期的第一天，想要告别孤独的少女遇到了意想不到的朋友。关于友情与心动的校园故事。',
  },
  {
    title: '我怎么可能成为你的恋人，办不到办不到！（※不是不可能！？）',
    author: 'みかみてれん',
    count: 42,
    genre: '校园,恋爱',
    description: '放学后的一次约定，让原本平静的日常有了新的变化。',
  },
  {
    title: '葬送的芙莉莲',
    author: '山田钟人',
    count: 140,
    genre: '奇幻,冒险',
    description: '旅途结束之后，还有漫长的时间去理解沿途相遇的人。',
  },
  {
    title: '迷宫饭',
    author: '九井谅子',
    count: 97,
    genre: '奇幻,美食',
    completed: true,
    description: '探索迷宫的队伍，在一次次寻常的用餐里发现新的秘密。',
  },
  {
    title: '雨后的书店',
    author: '白川灯',
    count: 24,
    genre: '日常,治愈',
    completed: true,
    description: '街角的小书店，在雨后迎来了第一位客人。',
  },
  {
    title: '夏日未完',
    author: '青野遥',
    count: 63,
    genre: '青春,校园',
    description: '写在旧笔记本里的愿望，终于在这个夏天有了回应。',
  },
  {
    title: '跃动青春',
    author: '高松美咲',
    count: 74,
    genre: '校园,日常',
    description: '带着期待来到新学校，每一天都有值得记住的小事。',
  },
  {
    title: '青之箱',
    author: '三浦糀',
    count: 118,
    genre: '运动,恋爱',
    description: '清晨的体育馆里，少年与少女追逐着各自的目标。',
  },
  {
    title: '蓝色时期',
    author: '山口飞翔',
    count: 88,
    genre: '艺术,青春',
    description: '一幅画，让平凡的生活开始有了自己的颜色。',
  },
  {
    title: '间谍过家家',
    author: '远藤达哉',
    count: 106,
    genre: '喜剧,家庭',
    description: '每个人都藏着小小的秘密，却仍努力守护这个家。',
  },
  {
    title: '海边的邮局',
    author: '南川和',
    count: 18,
    genre: '日常,治愈',
    completed: true,
    description: '一封没有地址的信，把海边小镇的人们联系在一起。',
  },
  {
    title: '星港来信',
    author: '林间',
    count: 32,
    genre: '科幻,冒险',
    description: '从遥远星港寄来的信，记录着一场还没有结束的旅行。',
  },
  {
    title: '放学后的借书卡',
    author: '春野枝',
    count: 12,
    genre: '校园,恋爱',
    completed: true,
    description: '两个人借阅同一本书，在借书卡上留下了交错的名字。',
  },
  {
    title: '山间小路',
    author: '秋山澄',
    count: 46,
    genre: '日常,旅行',
    description: '沿着山间的小路，寻找藏在地图之外的风景。',
  },
  {
    title: '长夜的灯塔',
    author: '青木岬',
    count: 51,
    genre: '悬疑,冒险',
    description: '灯塔的光每晚如期亮起，守塔人却留下了一本奇怪的日记。',
  },
  {
    title: '不眠的天文台',
    author: '月见律',
    count: 58,
    genre: '科幻,青春',
    description: '在旧天文台的屋顶，几个少年共同守候一场流星雨。',
  },
  {
    title: '晚风与旧唱片',
    author: '松原叶',
    count: 7,
    genre: '音乐,日常',
    completed: true,
    description: '唱片店的晚风里，响起一首许久没有听过的歌。',
  },
  {
    title: '猫和日曜日',
    author: '小岛森',
    count: 40,
    genre: '喜剧,治愈',
    description: '一只喜欢散步的猫，让普通的星期日变得热闹起来。',
  },
  {
    title: '星港来信 第2部',
    author: '林间',
    count: 20,
    genre: '科幻,冒险',
    description: '星港的下一封信，写着通往新世界的航线。',
  },
  {
    title: '新学期的序章',
    author: '春野枝',
    count: 0,
    genre: '校园,日常',
    description: '即将开篇的新故事，目录暂未发布。',
  },
].map((work, index) => ({ ...work, id: index + 1 }));

const PAGE_SIZE = 8;
const SOURCE_OFFSETS = [0, 4, -2, 2, -4];

function sourceIndex(sourceId) {
  const index = sources.findIndex((source) => source.id === String(sourceId));
  if (index < 0) throw new MockError('漫画源不存在', 'NOT_FOUND');
  return index;
}

function available(work, index) {
  return work.id === 1 || (work.id + index) % sources.length !== 0;
}

function edition(work, index) {
  const source = sources[index];
  const count =
    work.count === 0 || work.completed
      ? work.count
      : Math.max(1, work.count + SOURCE_OFFSETS[index]);
  const id = String((index + 1) * 10000 + work.id);
  const title =
    index % 2
      ? work.title
          .replaceAll('，', ',')
          .replaceAll('！', '!')
          .replaceAll('？', '?')
      : work.title;
  return {
    work,
    source,
    count,
    manga: {
      id,
      sourceId: source.id,
      title,
      thumbnailUrl: `/mock/covers/${id}.svg`,
      description: work.description,
      author: work.author,
      artist: work.author,
      genre: work.genre,
      status: work.completed ? 'COMPLETED' : 'ONGOING',
    },
  };
}

export function getEdition(mangaId) {
  const value = Number(mangaId);
  if (!/^\d+$/.test(String(mangaId)) || !Number.isSafeInteger(value))
    throw new MockError('漫画 ID 无效');
  const index = Math.floor(value / 10000) - 1;
  const work = works.find((candidate) => candidate.id === value % 10000);
  if (!sources[index] || !work || !available(work, index))
    throw new MockError('漫画不存在', 'NOT_FOUND');
  return edition(work, index);
}

export function getManga(mangaId) {
  return getEdition(mangaId).manga;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
}

export function fetchSourceManga(input = {}) {
  const index = sourceIndex(input.source);
  const type = input.type || 'POPULAR';
  if (!['SEARCH', 'POPULAR', 'LATEST'].includes(type))
    throw new MockError('不支持的推荐类型');
  const page = Number(input.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1)
    throw new MockError('页码必须为正整数');
  let list = works.filter((work) => available(work, index));
  if (type === 'SEARCH') {
    const keyword = normalize(input.query);
    list = list.filter((work) =>
      normalize(`${work.title} ${work.author} ${work.genre} 漫画`).includes(
        keyword
      )
    );
  } else if (type === 'LATEST') {
    list = [...list].reverse();
  }
  const offset = (page - 1) * PAGE_SIZE;
  return {
    mangas: list
      .slice(offset, offset + PAGE_SIZE)
      .map((work) => edition(work, index).manga),
    hasNextPage: offset + PAGE_SIZE < list.length,
  };
}

export function getChapters(mangaId) {
  const { manga, source, count } = getEdition(mangaId);
  return Array.from({ length: count }, (_, index) => {
    const number = count - index;
    return {
      id: String(Number(manga.id) * 10000 + number),
      mangaId: manga.id,
      name: `第${String(number).padStart(2, '0')}话`,
      chapterNumber: number,
      scanlator: source.name,
      isRead: false,
      isDownloaded: false,
      pageCount: 6 + (number % 3),
      uploadDate: Date.UTC(2025, 0, 1) + number * 86400000,
    };
  });
}

export function getChapter(chapterId) {
  const value = Number(chapterId);
  if (!/^\d+$/.test(String(chapterId)) || !Number.isSafeInteger(value))
    throw new MockError('章节 ID 无效');
  const item = getEdition(String(Math.floor(value / 10000)));
  const number = value % 10000;
  if (number < 1 || number > item.count)
    throw new MockError('章节不存在', 'NOT_FOUND');
  return { ...item, id: String(value), number, pageCount: 6 + (number % 3) };
}

export function getChapterPages(chapterId) {
  const chapter = getChapter(chapterId);
  return Array.from(
    { length: chapter.pageCount },
    (_, index) => `/mock/pages/${chapter.id}/${index}.svg`
  );
}

export function getStats() {
  const editions = sources.flatMap((source, index) =>
    works
      .filter((work) => available(work, index))
      .map((work) => edition(work, index))
  );
  return {
    sources: sources.length,
    titles: works.length,
    editions: editions.length,
    chapters: editions.reduce((sum, item) => sum + item.count, 0),
  };
}

export function executeGraphql({ query, variables = {} } = {}) {
  if (typeof query !== 'string' || !query.trim())
    throw new MockError('缺少 GraphQL query');
  const data = {};
  if (/\bsources\s*(?:\(|\{)/.test(query))
    data.sources = {
      nodes: sources.map((source) => ({ ...source })),
      totalCount: sources.length,
    };
  if (/\bfetchSourceManga\s*\(/.test(query))
    data.fetchSourceManga = fetchSourceManga(variables.input);
  if (/\bfetchChapters\s*\(/.test(query))
    data.fetchChapters = { chapters: getChapters(variables.input?.mangaId) };
  if (/\bmanga\s*\(/.test(query)) data.manga = getManga(variables.id);
  if (/\bfetchChapterPages\s*\(/.test(query))
    data.fetchChapterPages = {
      pages: getChapterPages(variables.input?.chapterId),
    };
  if (Object.keys(data).length === 0)
    throw new MockError('不支持的 GraphQL 操作');
  return { data };
}
