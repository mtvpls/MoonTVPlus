import { getChapter, getEdition, MockError } from './catalog.mjs';

const palettes = [
  { sky: '#c8dfe8', accent: '#748d9f', shirt: '#c695a7' },
  { sky: '#f1d7d6', accent: '#bd8999', shirt: '#718b8a' },
  { sky: '#d9e2cc', accent: '#8b9b74', shirt: '#a88868' },
  { sky: '#e5dcba', accent: '#b59a6e', shirt: '#8387a4' },
];

function xml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[
        character
      ])
  );
}

function lines(text, length, limit = 4) {
  const characters = Array.from(text);
  return Array.from(
    { length: Math.min(limit, Math.ceil(characters.length / length)) },
    (_, index) =>
      characters.slice(index * length, (index + 1) * length).join('')
  );
}

function person(x, y, scale, shirt, flip = false) {
  return `<g transform="translate(${x} ${y}) scale(${
    flip ? -scale : scale
  } ${scale})" stroke="#37322d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-52 135 Q-51 74-25 62 L25 62 Q51 74 52 135 Z" fill="${shirt}"/>
    <path d="M-25 64 L0 89 25 64 M0 90 V134 M-37 84 L-40 132 M37 84 L40 132" fill="none"/>
    <path d="M-12 43 V65 L0 78 12 65 V43" fill="#f8e5d8"/>
    <ellipse cy="2" rx="37" ry="46" fill="#f8e5d8"/>
    <path d="M-37 4 Q-48-39-14-48 Q32-61 39-12 L37 28 26 1 13-25-1-7-14-28-28-5-37 28 Z" fill="#5a4a48"/>
    <path d="M-22 9 Q-15 4-9 10 M9 10 Q16 4 23 9 M-4 25 Q0 28 4 25 M-10 34 Q0 41 10 34" fill="none"/>
  </g>`;
}

function bubble(x, y, width, text) {
  const wrapped = lines(text, Math.max(5, Math.floor((width - 20) / 16)), 3);
  const height = wrapped.length * 23 + 22;
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="#fffdf8" stroke="#37322d" stroke-width="2"/>
    ${wrapped
      .map(
        (line, index) =>
          `<text x="${x + width / 2}" y="${
            y + 27 + index * 23
          }" text-anchor="middle" font-size="16">${xml(line)}</text>`
      )
      .join('')}
  </g>`;
}

function cover(mangaId) {
  const { work, source, manga, count } = getEdition(mangaId);
  const palette = palettes[(work.id - 1) % palettes.length];
  const title = lines(work.title, 13, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#faf3e4"/>
    <rect x="18" y="18" width="564" height="764" fill="none" stroke="${
      palette.accent
    }" stroke-width="2"/>
    <path d="M30 268 Q300 183 570 280 V724 H30 Z" fill="${palette.sky}"/>
    <circle cx="432" cy="349" r="68" fill="#fff8df"/>
    <path d="M30 505 H87 V452 H133 V513 H184 V404 H228 V485 H279 V446 H322 V506 H382 V465 H428 V413 H466 V491 H522 V440 H570 V724 H30 Z" fill="${
      palette.accent
    }" opacity=".5"/>
    <path d="M30 670 Q300 620 570 685 V724 H30 Z" fill="${palette.accent}"/>
    ${person(210, 463, 1.65, palette.shirt)}
    ${person(389, 523, 1.27, '#f5ede2', true)}
    <g fill="#37322d" font-family="Georgia, 'Noto Serif CJK SC', SimSun, serif">
      <text x="46" y="58" font-size="18">漫画 · ${String(work.id).padStart(
        2,
        '0'
      )}</text>
      ${title
        .map(
          (line, index) =>
            `<text x="46" y="${
              110 + index * 43
            }" font-size="35" font-weight="600">${xml(line)}</text>`
        )
        .join('')}
      <text x="46" y="761" font-size="20">${xml(work.author)}</text>
      <text x="552" y="761" text-anchor="end" font-size="16">${xml(
        source.name
      )} · ${count} 话</text>
    </g>
    <title>${xml(manga.title)}</title>
  </svg>`;
}

const dialogue = [
  ['今天也来得很早呢。', '因为有件事想告诉你。', '沿着这条路，再走一会儿吧。'],
  [
    '你看，窗外的雨停了。',
    '那就一起回去吧。',
    '原来普通的一天，也可以这样被记住。',
  ],
  [
    '这本书，是你留下的吗？',
    '下一页还有我的留言。',
    '故事还没有结束，我们明天再见。',
  ],
  ['我已经想好下一站了。', '那里会是什么样子？', '等我们到了，就知道了。'],
];

function page(chapterId, pageIndex) {
  const chapter = getChapter(chapterId);
  const index = Number(pageIndex);
  if (!Number.isInteger(index) || index < 0 || index >= chapter.pageCount)
    throw new MockError('页面不存在', 'NOT_FOUND');
  const palette = palettes[(chapter.work.id - 1) % palettes.length];
  const words = dialogue[(index + chapter.number) % dialogue.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
    <rect width="600" height="900" fill="#fffcf6"/>
    <g font-family="'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif" fill="#37322d">
      <text x="24" y="31" font-size="15">${xml(
        chapter.work.title.slice(0, 26)
      )}</text>
      <text x="576" y="58" text-anchor="end" font-size="14">第${String(
        chapter.number
      ).padStart(2, '0')}话 · ${index + 1} / ${chapter.pageCount}</text>
      <defs>
        <clipPath id="wide"><rect x="24" y="80" width="552" height="234"/></clipPath>
        <clipPath id="left"><rect x="24" y="332" width="266" height="224"/></clipPath>
        <clipPath id="right"><rect x="310" y="332" width="266" height="224"/></clipPath>
        <clipPath id="bottom"><rect x="24" y="574" width="552" height="262"/></clipPath>
      </defs>
      <g clip-path="url(#wide)">
        <rect x="24" y="80" width="552" height="234" fill="${palette.sky}"/>
        <path d="M24 220 H120 V161 H168 V235 H237 V126 H291 V221 H351 V177 H402 V225 H480 V141 H520 V211 H576 V314 H24 Z" fill="${
          palette.accent
        }" opacity=".45"/>
        ${person(159, 202, 0.85, palette.shirt)}${person(
    383,
    223,
    0.72,
    '#f5ede2',
    true
  )}
        ${bubble(330, 95, 222, words[0])}
      </g>
      <g clip-path="url(#left)">
        <rect x="24" y="332" width="266" height="224" fill="#eee8db"/>
        ${person(154, 454, 1.37, palette.shirt)}
        ${bubble(40, 345, 224, words[1])}
      </g>
      <g clip-path="url(#right)">
        <rect x="310" y="332" width="266" height="224" fill="${palette.sky}"/>
        <path d="M322 544 L552 345 M352 556 L576 364 M412 556 L576 412" stroke="#fffdf8" stroke-width="5" opacity=".7"/>
        ${person(443, 452, 1.31, '#f5ede2', true)}
      </g>
      <g clip-path="url(#bottom)">
        <rect x="24" y="574" width="552" height="262" fill="#f1eadf"/>
        <path d="M24 836 L245 575 H309 L576 836" stroke="${
          palette.accent
        }" stroke-width="4" fill="${palette.sky}"/>
        ${person(211, 734, 0.9, palette.shirt)}${person(
    380,
    742,
    0.86,
    '#f5ede2',
    true
  )}
        ${bubble(292, 590, 266, words[2])}
      </g>
      <g stroke="#37322d" stroke-width="3" fill="none">
        <rect x="24" y="80" width="552" height="234"/><rect x="24" y="332" width="266" height="224"/>
        <rect x="310" y="332" width="266" height="224"/><rect x="24" y="574" width="552" height="262"/>
      </g>
      <text x="24" y="875" font-size="13" fill="#8b8276">${xml(
        chapter.source.name
      )}</text>
      <text x="576" y="875" text-anchor="end" font-size="14">${index + 1}</text>
    </g>
    <title>第${chapter.number}话 · 第${index + 1}页</title>
  </svg>`;
}

export function renderImage(pathname) {
  const coverMatch = pathname.match(/^\/mock\/covers\/(\d+)\.svg$/);
  if (coverMatch) return cover(coverMatch[1]);
  const pageMatch = pathname.match(/^\/mock\/pages\/(\d+)\/(\d+)\.svg$/);
  if (pageMatch) return page(pageMatch[1], pageMatch[2]);
  return null;
}
