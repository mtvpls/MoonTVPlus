/**
 * 漫画 / 小说「暖纸书库」视觉语言的唯一定义处。
 *
 * 两套功能的所有书库页面都从这里取类名，避免同一套纸面/书脊/赭石强调被抄成十几份。
 * 色板定义在 tailwind.config.ts 的 colors.library 下。
 */

import { cn } from '@/lib/cn';

/** 页面底色：浅色是纸，深色是墨。 */
export const LIBRARY_PAGE = 'bg-library-paper dark:bg-library-night';

/** 实心纸面面板（取代原先的玻璃 + backdrop-blur）。 */
export const LIBRARY_PANEL =
  'rounded-lg border border-library-edge bg-library-card dark:border-library-night-edge dark:bg-library-night-card';

/** 正文主色。 */
export const LIBRARY_TEXT = 'text-library-ink dark:text-library-night-ink';

/** 次要信息。 */
export const LIBRARY_MUTED = 'text-library-muted dark:text-library-night-muted';

/** 书卷衬线，用在书名与小节标题上。 */
export const LIBRARY_SERIF = 'font-book';

/** 赭石强调：实心按钮。 */
export const LIBRARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-md bg-library-ochre px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-library-ochre-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-library-ochre focus-visible:ring-offset-2 focus-visible:ring-offset-library-paper dark:bg-library-night-ochre dark:hover:bg-library-night-ochre/90 dark:focus-visible:ring-library-night-ochre dark:focus-visible:ring-offset-library-night';

/** 赭石强调：描边按钮。 */
export const LIBRARY_GHOST_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-md border border-library-edge px-4 py-2.5 text-sm font-medium text-library-ink transition-colors duration-200 hover:border-library-ochre hover:text-library-ochre focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-library-ochre dark:border-library-night-edge dark:text-library-night-ink dark:hover:border-library-night-ochre dark:hover:text-library-night-ochre';

/** 焦点环，统一给书库区的可聚焦元素用。 */
export const LIBRARY_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-library-ochre dark:focus-visible:ring-library-night-ochre';

/** 输入框 / 下拉框：纸面凹陷，聚焦时边框转赭石。 */
export const LIBRARY_FIELD =
  'w-full rounded-md border border-library-edge bg-library-paper px-4 py-3 text-sm text-library-ink outline-none transition-colors duration-200 placeholder:text-library-muted focus:border-library-ochre dark:border-library-night-edge dark:bg-library-night dark:text-library-night-ink dark:placeholder:text-library-night-muted dark:focus:border-library-night-ochre';

/** 圆形图标按钮（缓存管理、清空这类工具栏按钮）。 */
export const LIBRARY_ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-library-edge text-library-muted transition-colors duration-200 hover:border-library-ochre hover:text-library-ochre dark:border-library-night-edge dark:text-library-night-muted dark:hover:border-library-night-ochre dark:hover:text-library-night-ochre';

/** 同上，危险操作（删除 / 清空）。 */
export const LIBRARY_ICON_BUTTON_DANGER =
  'inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-library-edge text-library-muted transition-colors duration-200 hover:border-red-400 hover:text-red-600 dark:border-library-night-edge dark:text-library-night-muted dark:hover:border-red-500/60 dark:hover:text-red-400';

/** 无边框圆图标按钮：顶栏里的工具按钮（章节、设置、更多）。 */
export const LIBRARY_ICON_BUTTON_GHOST =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-library-muted transition-colors duration-200 hover:bg-library-ochre-tint hover:text-library-ochre dark:text-library-night-muted dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre';

/** 下拉菜单里的一项。 */
export const LIBRARY_MENU_ITEM =
  'flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-sm text-library-ink transition-colors duration-200 hover:bg-library-ochre-tint hover:text-library-ochre dark:text-library-night-ink dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre';

/** 面板内的一行纸面（章节行、格式行）。 */
export const LIBRARY_ROW =
  'rounded-md border border-library-edge bg-library-paper/70 dark:border-library-night-edge dark:bg-library-night/60';

/** 行的高亮态：当前章节 / 连载中。 */
export const LIBRARY_ROW_ACTIVE =
  'border-library-ochre bg-library-ochre-tint dark:border-library-night-ochre dark:bg-library-night-ochre-tint';

/** 骨架块。 */
export const LIBRARY_SKELETON =
  'animate-pulse rounded-sm bg-library-edge dark:bg-library-night-edge';

/** 进度条：轨道 + 赭石填充。 */
export const LIBRARY_PROGRESS_TRACK =
  'overflow-hidden rounded-full bg-library-edge dark:bg-library-night-edge';
export const LIBRARY_PROGRESS_BAR =
  'h-full rounded-full bg-library-ochre transition-all duration-300 dark:bg-library-night-ochre';

/**
 * 小节标题下的说明行（"共 N 条"这类）。图标单独上色，用 LIBRARY_ACCENT_ICON。
 */
export const LIBRARY_ACCENT_ICON =
  'text-library-ochre dark:text-library-night-ochre';

/**
 * 封面读起来像一本立着的书：外层是贴地投影，内层（renderBookSpineOverlay 里的
 * inset 阴影）是书脊处的高光与暗部。两者必须分开——inset 阴影画在子元素之下，
 * 会被封面图整个盖住，所以只能做成覆盖层。
 */
export const BOOK_COVER_LIFT =
  'shadow-[0_1px_2px_rgba(0,0,0,0.22),0_12px_24px_-16px_rgba(0,0,0,0.5)]';

/** 覆盖在封面之上的书脊层，必须放在 <img> 之后。 */
export const BOOK_SPINE_OVERLAY =
  'pointer-events-none absolute inset-0 shadow-[inset_3px_0_0_rgba(255,255,255,0.14),inset_6px_0_10px_-6px_rgba(0,0,0,0.55)]';

/** 书架板：横滑 rail 底部那条木色细线。 */
export const BOOK_SHELF_BOARD =
  'border-b border-library-edge dark:border-library-night-edge';

/** 横滑容器：隐藏滚动条，保留手势滚动。 */
export const BOOK_RAIL =
  'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** rail 中每一项的宽度。 */
export const BOOK_RAIL_ITEM = 'w-24 shrink-0 snap-start sm:w-28';

/**
 * 封面右下角的书架开关（书墙与搜索结果共用）。
 *
 * 图标是白的——白图标必须有深底托着，所以底色由调用方跟着状态给：
 * 未收藏用半透明墨（和封面左上角的角标同一套），已收藏换赭石。
 * inline-flex + items/justify-center 是让图标在圆里居中，别指望 button 的 UA 默认对齐。
 * 用 library-chip 而不是 bg-white / text-white：后者会被管理端主题层的
 * [class*="bg-white"] !important 覆盖掉。
 */
export const SHELF_CHIP =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border-transparent p-0 text-library-chip shadow-md backdrop-blur-sm transition-colors duration-200';

/** 书脊标签（书源 / 分类切换）：方角 + 选中时底部一道赭石。 */
export const SPINE_TAB =
  'relative shrink-0 whitespace-nowrap rounded-t-md px-3.5 pb-2.5 pt-2 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-library-ochre dark:focus-visible:ring-library-night-ochre';

export const SPINE_TAB_ACTIVE =
  'bg-library-ochre-tint font-medium text-library-ochre after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-library-ochre dark:bg-library-night-ochre-tint dark:text-library-night-ochre dark:after:bg-library-night-ochre';

export const SPINE_TAB_IDLE =
  'text-library-muted hover:bg-library-ochre-tint/50 hover:text-library-ochre dark:text-library-night-muted dark:hover:bg-library-night-ochre-tint/50 dark:hover:text-library-night-ochre';

/** 目录里的文字切源：保留点击区域，选中时只在文字下留一道短线。 */
export const LIBRARY_TEXT_TAB =
  'relative inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap px-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-library-ochre dark:focus-visible:ring-library-night-ochre';

export const LIBRARY_TEXT_TAB_ACTIVE =
  'font-medium text-library-ochre after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-library-ochre dark:text-library-night-ochre dark:after:bg-library-night-ochre';

export const LIBRARY_TEXT_TAB_IDLE =
  'text-library-muted hover:text-library-ochre dark:text-library-night-muted dark:hover:text-library-night-ochre';

/**
 * 阅读器：页面图像下方的衬底。原来是一块中性灰，换成纸的暗部，
 * 翻页时露出的"桌面"也跟着进了暖色系。
 */
export const READER_CANVAS = 'bg-library-edge dark:bg-library-night-edge';

/** 同上，加载中的占位块。 */
export const READER_CANVAS_SKELETON =
  'animate-pulse bg-library-edge dark:bg-library-night-edge';

/**
 * 阅读器里的浮层纸面：设置面板、章节抽屉、章节读完弹窗。
 * 比书库面板多一层投影——这些浮层是压在翻页画布上的，需要和画布分开。
 */
export const READER_SHEET =
  'rounded-lg border border-library-edge bg-library-card shadow-xl dark:border-library-night-edge dark:bg-library-night-card';

/**
 * 阅读器的分段选择（显示方式 / 缩放类型）。
 * 选中是赭石实心，未选中也要有描边 + 纸底：两组选项都能点，
 * 只留纯文字的话，未选中那个看起来像说明文字而不像按钮。
 * 两种状态都保留 border（选中时与底色同色），切换时盒子尺寸不变、不跳动。
 */
export const READER_SEGMENT = cn(
  'cursor-pointer rounded-md border px-3 py-2 text-center text-sm transition-colors duration-200',
  LIBRARY_FOCUS
);
export const READER_SEGMENT_ACTIVE =
  'border-library-ochre bg-library-ochre font-medium text-white dark:border-library-night-ochre dark:bg-library-night-ochre';
export const READER_SEGMENT_IDLE =
  'border-library-edge bg-library-paper text-library-ink hover:border-library-ochre hover:bg-library-ochre-tint hover:text-library-ochre dark:border-library-night-edge dark:bg-library-night-edge dark:text-library-night-ink dark:hover:border-library-night-ochre dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre';

/** 阅读器的滑块（图片间隔、字号、行距、语速），accent 跟着强调色走。 */
export const READER_SLIDER =
  'w-full cursor-pointer accent-library-ochre dark:accent-library-night-ochre';

/**
 * 阅读器里的实心圆图标按钮（TTS 控制条那一排小键）。
 * 浅色用比卡片更深的纸，深色用比卡片更亮的墨边色——两个方向都是"从底面上浮起来"。
 */
export const READER_ICON_BUTTON =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-library-paper text-library-muted transition-colors duration-200 hover:bg-library-ochre-tint hover:text-library-ochre disabled:opacity-40 dark:bg-library-night-edge dark:text-library-night-muted dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre';

/** 阅读器的圆形播放钮（TTS 主键）。尺寸由调用方给：h-10 w-10 / h-14 w-14。 */
export const READER_PLAY_BUTTON =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-library-ochre text-white transition-colors duration-200 hover:bg-library-ochre-hover disabled:opacity-50 dark:bg-library-night-ochre dark:hover:bg-library-night-ochre/90';

/** 压在图像上的读数胶囊（页码、进度提示）：深墨半透 + 纸白字。 */
export const READER_HUD =
  'bg-library-ink/75 text-library-paper backdrop-blur-sm dark:bg-library-night-card/80 dark:text-library-night-ink';

/** 章节读完之类的浮层提示气泡（悬停章节名）。 */
export const READER_TOOLTIP =
  'bg-library-ink text-library-paper dark:bg-library-night-card dark:text-library-night-ink';
