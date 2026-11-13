'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import DownloadEpisodeSelector from '@/components/DownloadEpisodeSelector';
import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';
import { useDownload } from '@/contexts/DownloadContext';
import {
  deleteFavorite,
  generateStorageKey,
  getAllPlayRecords,
  isFavorited,
  saveFavorite,
  savePlayRecord,
} from '@/lib/db.client';
import {
  buildEpisodeProgressContentKey,
  loadLocalEpisodeProgressRecord,
  saveLocalEpisodeProgress,
} from '@/lib/episode-progress';
import {
  createAdFilteringHlsLoader,
  loadCustomAdFilterCode,
} from '@/lib/hls-ad-filter.client';
import { appendSpecialSourceParam } from '@/lib/special-source.client';
import type { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

/* 短剧竖屏播放页样式：整体照原型 index.html 移植，选择器统一挂 #djplayer 前缀，
   避免污染全局。播放层单独套 .touchguard 吃 touch-action:none（抽屉要能滚）。 */
const LOCAL_CSS = `
#djplayer {
  --surface:#ffffff; --surface-2:#f5f7fb; --fg:#14161c; --muted:#5f6775; --line:#dbe1ea;
  --accent: var(--theme-primary, #10b981);
  --accent-2: var(--theme-primary-hover, #059669);
  --accent-ink:#04140d; --player:#05070c; --scrim:rgba(10,12,18,.55); --radius:14px;
  position: fixed; inset: 0; overflow: hidden; background: var(--player); color: #fff;
  display: flex; align-items: center; justify-content: center;
  /* "手机屏"的宽：竖屏时就是整屏宽；宽屏（PC / 横屏）按高度算 9:16 居中，两侧留黑。
     抽屉也按这个宽度收进来，不然竖列居中、抽屉却横跨整个显示器。
     --col-num 是画面宽高比（默认竖屏 9:16）；横屏视频由 JS 按视频实际比例覆盖，
     机位框跟着变宽，画面才不会被 9:16 的框裁成一条竖条。 */
  --col-num: 0.5625;
  --col-w: min(100vw, calc(100vh * var(--col-num)));
  --col-w: min(100vw, calc(100dvh * var(--col-num)));
  --col-x: calc((100vw - var(--col-w)) / 2);
  font-family: "Noto Sans SC", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased; overscroll-behavior: none;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) #djplayer {
    --surface:#14161d; --surface-2:#1a1d27; --fg:#edeff6; --muted:#99a1b1; --line:#272b37;
    --accent: var(--theme-primary, #10b981);
    --accent-2: var(--theme-primary-hover, #34d399);
    --player:#000000; --scrim:rgba(0,0,0,.62);
  }
}
:root[data-theme="dark"] #djplayer {
  --surface:#14161d; --surface-2:#1a1d27; --fg:#edeff6; --muted:#99a1b1; --line:#272b37;
  --accent: var(--theme-primary, #10b981);
  --accent-2: var(--theme-primary-hover, #34d399);
  --player:#000000; --scrim:rgba(0,0,0,.62);
}
#djplayer, #djplayer * { box-sizing: border-box; }
/* touchguard 就是"手机屏"：宽度取 --col-w（竖屏满宽 / 宽屏居中 9:16 竖列）。
   播放层的浮层（顶栏/右栏/底栏/菜单/toast）用 absolute 钉在这块屏上——
   抽屉在外面（要能滚），单独按 --col-x 收进来。 */
#djplayer .touchguard { position:relative; flex:none; width:var(--col-w); max-width:100%; height:100%; touch-action:none; user-select:none; }

/* 播放层：竖排轨道。每一集是一个占满屏的 eslot，按集号固定偏移 ep*100%，
   轨道整体按 -当前集*100% 平移；拖动时叠加手指位移，松手做 300ms 过渡。
   页面自绘一套 UI，所以这里只放 <video>，不引任何播放器皮肤。 */
#djplayer .stage { position:absolute; inset:0; z-index:0; overflow:hidden; background:#000; pointer-events:none; }
#djplayer .track { position:absolute; inset:0; will-change: transform; }
#djplayer .eslot { position:absolute; inset:0; overflow:hidden; background:#000; }
#djplayer .eslot video { width:100%; height:100%; object-fit:cover; display:block; }
/* 横屏/方屏视频：机位框已经按视频比例收窄了，画面按原比例完整显示，别再裁。
   （竖屏短剧那条路保持 cover，铺满整屏才是红果那种观感） */
#djplayer.fit .eslot video { object-fit: contain; }

/* 本页是整屏播放器：锁住文档滚动，别让页面能滚走顶栏 */
html:has(#djplayer), body:has(#djplayer) { height:100%; overflow:hidden; overscroll-behavior:none; }

/* 顶栏 */
#djplayer .top {
  position:absolute; top:0; left:0; right:0; z-index:4; display:flex; align-items:center; gap:10px;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 10px;
  background: linear-gradient(180deg, rgba(0,0,0,0.62), transparent);
}
#djplayer .iconbtn {
  display:inline-grid; place-items:center; width:34px; height:34px; flex:none;
  border-radius:50%; border:none; cursor:pointer; color:#fff;
  background: rgba(255,255,255,0.14); backdrop-filter: blur(6px);
}
#djplayer .iconbtn:active { transform: scale(0.94); }
#djplayer .top .name {
  font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; flex:1; min-width:0; text-shadow:0 1px 6px rgba(0,0,0,0.6);
}

/* 右侧操作列 */
#djplayer .rail {
  position:absolute; right:10px; bottom:128px; z-index:6; display:flex; flex-direction:column; gap:16px;
  transition: opacity .25s ease, transform .25s ease;
}
#djplayer .railbtn {
  position:relative; display:grid; place-items:center; gap:3px; width:52px;
  border:none; background:none; color:#fff; cursor:pointer; font-family:inherit;
}
#djplayer .railbtn .bubble {
  display:grid; place-items:center; width:46px; height:46px; border-radius:50%;
  background: rgba(255,255,255,0.16); backdrop-filter: blur(8px);
  border:1px solid rgba(255,255,255,0.12);
}
#djplayer .railbtn:active .bubble { transform: scale(0.93); }
#djplayer .railbtn.on .bubble { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
#djplayer .railbtn.on .lab { color: var(--accent-2); font-weight:700; }
@keyframes dj-pop { 0% { transform: scale(1); } 40% { transform: scale(1.24); } 100% { transform: scale(1); } }
#djplayer .railbtn.pop .bubble { animation: dj-pop .34s ease; }
#djplayer .railbtn .lab { font-size:11px; text-shadow:0 1px 4px rgba(0,0,0,0.7); }
#djplayer .railbtn .badge {
  position:absolute; top:-3px; right:2px; min-width:18px; height:18px; padding:0 4px;
  border-radius:999px; background: var(--accent); color: var(--accent-ink);
  font-size:11px; font-weight:900; display:grid; place-items:center; border:2px solid var(--player);
}

/* 中央播放态 */
#djplayer .center { position:absolute; inset:0; z-index:3; display:grid; place-items:center; pointer-events:none; }
#djplayer .bigplay {
  width:66px; height:66px; border-radius:50%; display:grid; place-items:center;
  background: rgba(0,0,0,0.42); backdrop-filter: blur(4px);
  border:1px solid rgba(255,255,255,0.18);
  opacity:0; transform: scale(0.8); transition: opacity .25s, transform .25s;
}
#djplayer.paused .bigplay { opacity:1; transform: scale(1); }
/* 加载中（未起播）只留转圈：这时 <video> 是 paused 的，不压掉播放键会和转圈叠在一起 */
#djplayer.loading .bigplay { opacity:0; transform: scale(0.8); }

/* 底部信息 + 进度 */
#djplayer .bottom {
  position:absolute; left:0; right:0; bottom:0; z-index:4;
  padding: 34px 14px calc(16px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(0deg, rgba(0,0,0,0.86) 12%, rgba(0,0,0,0.42) 62%, transparent);
}
#djplayer .epblock { display:flex; align-items:center; gap:8px; margin-top:12px; }
#djplayer .eplab {
  flex:1; min-width:0; display:flex; align-items:center;
  background:none; border:none; color:#fff; cursor:pointer; font-family:inherit;
  padding:6px 4px; text-align:left; border-radius:10px;
}
#djplayer .eplab:hover { background: rgba(255,255,255,0.08); }
#djplayer .eplab .ep {
  font-size:15px; font-weight:900; font-variant-numeric: tabular-nums;
  text-shadow:0 1px 6px rgba(0,0,0,0.7);
}
#djplayer .eplab .ep em { color: var(--accent-2); font-style:normal; }
#djplayer .clearbtn, #djplayer .fsbtn {
  flex:none; display:inline-grid; place-items:center; width:34px; height:34px;
  border-radius:50%; border:none; cursor:pointer; color:#fff;
  background: rgba(255,255,255,0.16); backdrop-filter: blur(6px);
}
#djplayer .clearbtn:hover, #djplayer .fsbtn:hover { background: rgba(255,255,255,0.26); }
#djplayer .clearbtn:active, #djplayer .fsbtn:active { transform: scale(0.93); }
#djplayer .clearbtn:not(.on) .icon-off { display:none; }
#djplayer .clearbtn.on .icon-on { display:none; }
#djplayer .info { position:relative; max-height:240px; overflow:hidden; transition: max-height .25s ease, opacity .25s ease; }
#djplayer .vt {
  display:flex; align-items:center; gap:5px; width:100%;
  background:none; border:none; color:#fff; font-family:inherit; cursor:pointer;
  padding:2px 4px 0; text-align:left; text-shadow:0 1px 6px rgba(0,0,0,0.7); transition: opacity .12s ease;
}
#djplayer .vt .t {
  font-size:15.5px; font-weight:800; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
#djplayer .vt svg { flex:none; opacity:0.75; }
#djplayer .desc {
  width:100%; background:none; border:none; color:rgba(255,255,255,0.72);
  font-family:inherit; font-size:12.5px; line-height:1.6; text-align:left; cursor:pointer;
  margin:7px 0 0; padding:0 4px; text-shadow:0 1px 4px rgba(0,0,0,0.6); transition: opacity .12s ease;
}
#djplayer .desc .dtext {
  display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden;
}
#djplayer .desc.expanded .dtext { -webkit-line-clamp:6; }
#djplayer .seektime {
  position:absolute; left:4px; bottom:0; display:flex; align-items:baseline; gap:5px;
  opacity:0; pointer-events:none; transition: opacity .14s ease;
  color:#fff; font-variant-numeric: tabular-nums; text-shadow:0 1px 6px rgba(0,0,0,0.8);
}
#djplayer .seektime b { font-size:16px; font-weight:800; }
#djplayer .seektime .sep { font-size:12px; opacity:0.5; }
#djplayer .seektime .tot { font-size:12.5px; opacity:0.8; }
#djplayer .info.seeking .vt, #djplayer .info.seeking .desc { opacity:0; }
#djplayer .info.seeking .seektime { opacity:1; }
#djplayer .seek { position:relative; margin-top:4px; padding:10px 0; cursor:pointer; touch-action:none; }
#djplayer .bar { height:3px; border-radius:999px; background: rgba(255,255,255,0.24); overflow:hidden; }
#djplayer .bar > i { display:block; height:100%; width:0; background: var(--accent); border-radius:999px; }
#djplayer .thumb {
  position:absolute; top:50%; left:0; width:12px; height:12px; border-radius:50%;
  background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.55); pointer-events:none;
  transform: translate(-50%,-50%) scale(0); transition: transform .16s ease;
}
#djplayer .seek:hover .thumb, #djplayer .seek.seeking .thumb { transform: translate(-50%,-50%) scale(1); }
#djplayer.clean .rail { opacity:0; transform: translateX(12px); pointer-events:none; }
#djplayer.clean .info { max-height:0; opacity:0; }

/* 右上角「更多」菜单 */
#djplayer .menu {
  position:absolute; top: calc(52px + env(safe-area-inset-top, 0px)); right:12px; z-index:7; width:194px;
  background: rgba(18,20,26,0.96); backdrop-filter: blur(10px);
  border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:6px;
  display:none; box-shadow:0 16px 40px -18px rgba(0,0,0,0.85);
}
#djplayer .menu.on { display:block; }
#djplayer .mrow {
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  width:100%; background:none; border:none; color:#fff; font-family:inherit;
  font-size:13.5px; padding:11px 12px; border-radius:10px; cursor:pointer;
}
#djplayer .mrow:hover { background: rgba(255,255,255,0.08); }
#djplayer .mrow .val { color: var(--accent-2); font-weight:700; font-variant-numeric: tabular-nums; }
#djplayer .mdiv { height:1px; background: rgba(255,255,255,0.1); margin:5px 8px; }
#djplayer .speeds { display:none; flex-wrap:wrap; gap:6px; padding:2px 8px 10px; }
#djplayer .speeds.on { display:flex; }
#djplayer .speeds button {
  flex:1; min-width:46px; padding:7px 0; border-radius:8px; cursor:pointer;
  border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06);
  color:#fff; font-family:inherit; font-size:12px; font-variant-numeric: tabular-nums;
}
#djplayer .speeds button.cur { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight:700; }
#djplayer .sw { position:relative; flex:none; width:38px; height:22px; border-radius:999px; background: rgba(255,255,255,0.22); transition: background .2s; }
#djplayer .sw::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition: transform .2s; }
#djplayer .sw.on { background: var(--accent); }
#djplayer .sw.on::after { transform: translateX(16px); }
#djplayer .toast {
  position:absolute; left:50%; bottom:128px; z-index:9; transform: translate(-50%, 8px);
  background: rgba(0,0,0,0.82); color:#fff; font-size:12.5px; padding:8px 14px;
  border-radius:999px; opacity:0; pointer-events:none; white-space:nowrap;
  border:1px solid rgba(255,255,255,0.12); transition: opacity .2s, transform .2s;
}
#djplayer .toast.on { opacity:1; transform: translate(-50%, 0); }

/* 抽屉：窄屏底部弹 / 宽屏右侧拉 */
#djplayer .scrim {
  position:absolute; inset:0; z-index:40; background: var(--scrim);
  opacity:0; pointer-events:none; transition: opacity .28s;
}
#djplayer .scrim.on { opacity:1; pointer-events:auto; }
#djplayer .drawer {
  position:absolute; z-index:41; background: var(--surface); color: var(--fg);
  display:flex; flex-direction:column; box-shadow:0 -18px 50px -20px rgba(0,0,0,0.6);
  transition: transform .3s cubic-bezier(.2,.8,.25,1);
  inset: auto var(--col-x) 0 var(--col-x); max-height:78vh; border-radius:18px 18px 0 0; transform: translateY(101%);
}
#djplayer .drawer.on { transform: translateY(0); }
#djplayer .drawer .dhead {
  display:flex; align-items:center; gap:10px; padding:14px 16px;
  border-bottom:1px solid var(--line); position:sticky; top:0; background: var(--surface);
}
#djplayer .drawer .grab {
  position:absolute; top:7px; left:50%; transform: translateX(-50%);
  width:38px; height:4px; border-radius:999px; background: var(--line);
}
#djplayer .drawer .dtitle { font-size:15px; font-weight:800; }
#djplayer .drawer .dsub { font-size:12px; color: var(--muted); margin-left:auto; font-variant-numeric: tabular-nums; }
#djplayer .drawer .dbody { overflow-y:auto; padding:14px 16px 22px; }
#djplayer .drawer .dclose {
  margin-left:auto; display:inline-grid; place-items:center; width:30px; height:30px; flex:none;
  border-radius:50%; border:none; cursor:pointer; background: var(--surface-2); color: var(--fg);
}
@media (min-width: 821px) {
  #djplayer .drawer {
    inset: 0 var(--col-x) 0 auto; width: min(380px, var(--col-w)); max-height:none;
    /* 关闭位必须「挪出视口」，不是「挪出自己的宽度」：抽屉右边缘是缩进 --col-x 的，
       只 translateX(100%) 的话它只是停在竖列右边那条黑边里、整块常驻可见
       （三个抽屉同位，最后渲染的详情盖在最上面）。所以要连 --col-x 一起挪掉。 */
    border-radius:0; transform: translateX(calc(100% + var(--col-x) + 24px));
    box-shadow: -18px 0 50px -24px rgba(0,0,0,0.6);
  }
  #djplayer .drawer .grab { display:none; }
}

/* 选集网格 */
#djplayer .epgrid { display:grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap:8px; }
#djplayer .epcell {
  aspect-ratio:1; border-radius:10px; border:1px solid var(--line); background: var(--surface-2);
  color: var(--fg); font-family:inherit; font-size:13px; font-weight:700;
  font-variant-numeric: tabular-nums; cursor:pointer; display:grid; place-items:center;
}
#djplayer .epcell:hover { border-color: var(--accent); }
#djplayer .epcell.cur { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
#djplayer .epcell.watched { color: var(--muted); }

/* 换源列表 */
#djplayer .srcrow {
  display:flex; align-items:center; gap:12px; width:100%; text-align:left;
  padding:12px; border:1px solid var(--line); background: var(--surface-2);
  border-radius:12px; cursor:pointer; font-family:inherit; color: var(--fg); margin-bottom:8px;
}
#djplayer .srcrow:hover { border-color: var(--accent); }
#djplayer .srcrow.cur { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
#djplayer .srcrow .tick {
  width:22px; height:22px; flex:none; border-radius:50%; border:1.5px solid var(--line);
  display:grid; place-items:center; color:transparent;
}
#djplayer .srcrow.cur .tick { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
#djplayer .srcrow .meta { min-width:0; flex:1; display:flex; flex-direction:column; gap:5px; }
#djplayer .srcrow .srtop { display:flex; align-items:center; gap:7px; }
#djplayer .srcrow .sn { font-size:13.5px; font-weight:700; }
#djplayer .srcrow .cnt { margin-left:auto; font-size:11.5px; color: var(--muted); white-space:nowrap; }
#djplayer .srcrow .qn {
  flex:none; font-size:11.5px; font-weight:800; color: var(--muted); font-variant-numeric: tabular-nums;
}
#djplayer .srcrow .qn:empty { display:none; }
#djplayer .srcrow .qn.q-ultra { color:#a855f7; }
#djplayer .srcrow .qn.q-high { color:#10b981; }
#djplayer .srcrow .qn.q-low { color:#f59e0b; }
#djplayer .srcrow .stats {
  display:flex; align-items:center; gap:10px; font-size:11.5px; font-weight:600; font-variant-numeric: tabular-nums;
}
#djplayer .srcrow .stats.measuring { color: var(--muted); font-weight:500; }
#djplayer .srcrow .sp { color:#10b981; }
#djplayer .srcrow .pg { color:#f59e0b; }
#djplayer .srcrow .br { color:#a855f7; }
#djplayer .srcrow .err { color:#ef4444; }
#djplayer .srcrow .tag {
  margin-left:auto; font-size:11px; font-weight:700; color: var(--accent-2);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-radius:999px; padding:3px 8px; white-space:nowrap;
}
#djplayer .retest {
  font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; margin-left:10px;
  border:none; background:none; color: var(--accent-2); padding:4px 2px; white-space:nowrap;
}
#djplayer .retest:hover { text-decoration: underline; }
#djplayer .grpbar { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
#djplayer .ranges { display:flex; gap:6px; overflow-x:auto; flex:1; }
#djplayer .ranges button {
  flex:none; font-family:inherit; font-size:12px; font-weight:700; cursor:pointer;
  padding:5px 11px; border-radius:7px; border:1px solid var(--line);
  background: var(--surface-2); color: var(--fg); font-variant-numeric: tabular-nums;
}
#djplayer .ranges button.cur { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
#djplayer .flip {
  flex:none; width:28px; height:28px; border-radius:7px; cursor:pointer;
  border:none; background: var(--surface-2); color: var(--fg); display:grid; place-items:center;
}
#djplayer .flip:hover { color: var(--accent-2); }

/* 详情抽屉 */
#djplayer .dhero { display:flex; gap:12px; }
#djplayer .dposter {
  flex:none; width:104px; aspect-ratio:3/4; border-radius:12px; overflow:hidden;
  background: linear-gradient(160deg, #334155, #0b1120);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
}
#djplayer .dposter img { width:100%; height:100%; object-fit:cover; }
#djplayer .dname { margin:0 0 8px; font-size:16px; font-weight:800; line-height:1.35; }
#djplayer .dtags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
#djplayer .dtags span {
  font-size:11.5px; color: var(--muted); background: var(--surface-2);
  border:1px solid var(--line); border-radius:999px; padding:3px 9px;
}
#djplayer .dintro { margin:14px 0 0; font-size:13px; line-height:1.75; color: var(--fg); white-space:pre-wrap; }
#djplayer .dsect { margin:20px 0 10px; font-size:14px; font-weight:800; }
#djplayer .drecs { display:grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap:12px; }
#djplayer .rec {
  display:flex; flex-direction:column; gap:6px; padding:0; border:none; background:none;
  cursor:pointer; text-align:left; font-family:inherit; color: var(--fg);
}
#djplayer .recpic { width:100%; aspect-ratio:3/4; border-radius:10px; overflow:hidden; background: linear-gradient(160deg, #3b4a63, #0f172a); }
#djplayer .recpic img { width:100%; height:100%; object-fit:cover; }
#djplayer .rect {
  font-size:12.5px; font-weight:600; line-height:1.35; overflow:hidden;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
}
#djplayer .rece { font-size:11px; color: var(--muted); }
#djplayer .rec:hover .recpic { box-shadow: 0 0 0 2px var(--accent); }

@media (prefers-reduced-motion: reduce) {
  #djplayer .railbtn.pop .bubble { animation:none; }
  #djplayer .drawer, #djplayer .scrim, #djplayer .bigplay, #djplayer .rail,
  #djplayer .info, #djplayer .vt, #djplayer .desc, #djplayer .seektime,
  #djplayer .thumb, #djplayer .sw, #djplayer .sw::after, #djplayer .toast { transition:none; }
}
`;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const EP_PER_PAGE = 50;

function fmtSpeed(v: number): string {
  return v === 0.75 || v === 1.25 ? v.toFixed(2) : v.toFixed(1);
}
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
function qualityLabel(q: string): string {
  if (q === '4K' || q === '2K') return 'q-ultra';
  if (q === '1080p' || q === '720p') return 'q-high';
  return 'q-low';
}

/* 停在结尾附近的都当作「这集看完了」→ 从头开始，其余回到上次的位置。
   阈值不能只留几秒：手动划走时往往停在离结尾十几秒的地方，续播过去播一会儿
   就 ended、又自动跳到下一集（用户报过「切回上一集又跳走」）。
   最后 10%（至少 6 秒）都算看完。 */
function tailResumeTime(playTime: number, totalTime: number): number {
  if (!(playTime > 1)) return 0;
  if (totalTime > 0 && playTime >= totalTime - Math.max(6, totalTime * 0.1)) return 0;
  return playTime;
}

/* 该集应该从哪一秒续播（读分集进度记录）。 */
function resumeTimeFor(contentKey: string | null, episodeIndex: number): number {
  const rec = loadLocalEpisodeProgressRecord(contentKey, episodeIndex);
  if (!rec) return 0;
  return tailResumeTime(rec.playTime, rec.totalTime);
}

type SrcInfo =
  | { state: 'measuring' }
  | { state: 'done'; quality: string; speed: string; ping: number; bitrate: string }
  | { state: 'error'; label: string };

// 需要走 hls.js 的地址：直链 m3u8，以及本项目的两个代理
const HLS_RE = /\.m3u8(\?|$)|\/api\/proxy\/vod\/m3u8|\/api\/proxy-m3u8/i;

/* 一集 = 一层占满屏的 <video>。自己管 hls 实例，不做任何 UI。
   shouldPlay 由父组件按「当前集 / 正在滑入的下一集」决定。
   源地址优先浏览器直连（广告在 loader 里客户端过滤，跟 play 页一致）；
   直连失败（多半是 CORS）再自动退到服务端 /api/proxy-m3u8。 */
function EpisodeSlide({
  ep,
  url,
  proxyUrl,
  adFilter,
  source,
  customCodeRef,
  shouldPlay,
  speed,
  register,
  onFatal,
}: {
  ep: number;
  url: string;
  proxyUrl?: string;
  adFilter: boolean;
  source: string;
  customCodeRef: React.MutableRefObject<string>;
  shouldPlay: boolean;
  speed: number;
  register: (ep: number, el: HTMLVideoElement | null) => void;
  onFatal: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any>(null);
  const playRef = useRef(shouldPlay);
  playRef.current = shouldPlay;
  const triedProxyRef = useRef(false);
  const [activeUrl, setActiveUrl] = useState(url);

  // 源地址变了（换源/换集）就重置，并允许再走一次代理兜底
  useEffect(() => {
    triedProxyRef.current = false;
    setActiveUrl(url);
  }, [url]);

  useEffect(() => {
    register(ep, ref.current);
    return () => register(ep, null);
  }, [ep, register]);

  // 装载播放源
  useEffect(() => {
    const video = ref.current;
    if (!video || !activeUrl) return;
    let cancelled = false;
    let hls: any = null;

    // 致命错误：能退代理就退，否则报错
    const handleFatal = () => {
      if (!cancelled && proxyUrl && !triedProxyRef.current) {
        triedProxyRef.current = true;
        setActiveUrl(proxyUrl);
        return true;
      }
      return false;
    };

    (async () => {
      if (HLS_RE.test(activeUrl)) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (Hls.isSupported()) {
          const loader = adFilter
            ? createAdFilteringHlsLoader(
                Hls,
                () => source,
                () => customCodeRef.current
              )
            : undefined;
          hls = new Hls({
            maxBufferLength: 30,
            ...(loader ? { loader: loader as any } : {}),
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
            if (data?.fatal && !handleFatal()) onFatal();
          });
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (playRef.current) video.play().catch(() => {});
          });
          hls.loadSource(activeUrl);
          hls.attachMedia(video);
          return;
        }
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = activeUrl;
          if (playRef.current) video.play().catch(() => {});
          return;
        }
        onFatal();
        return;
      }
      video.src = activeUrl;
      if (playRef.current) video.play().catch(() => {});
    })();
    return () => {
      cancelled = true;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* noop */
        }
      }
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, adFilter, source, proxyUrl]);

  // 起播/暂停 + 倍速
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    try {
      video.playbackRate = speed;
    } catch {
      /* noop */
    }
    if (shouldPlay) video.play().catch(() => {});
    else video.pause();
  }, [shouldPlay, speed]);

  return (
    <video
      ref={ref}
      playsInline
      preload='auto'
      {...({ 'webkit-playsinline': 'true' } as Record<string, string>)}
    />
  );
}

function DuanjuPlayClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addDownloadTask } = useDownload();
  const watchRoomContext = useWatchRoomContextSafe();

  const sourceParam = searchParams.get('source') || '';
  const idParam = searchParams.get('id') || '';
  const titleParam = searchParams.get('title') || '';
  const yearParam = searchParams.get('year') || '';
  const fileNameParam = searchParams.get('fileName') || '';
  const episodeParam = searchParams.get('episode');

  // 观影室状态下不进入短剧竖屏沉浸播放页（/duanju/play 不支持房间同步），
  // 直接入口（持久化记录/外部链接等）统一转回普通播放页。
  useEffect(() => {
    if (!watchRoomContext?.currentRoom) return;
    const params = new URLSearchParams();
    if (sourceParam) params.set('source', sourceParam);
    if (idParam) params.set('id', idParam);
    if (titleParam) params.set('title', titleParam);
    if (yearParam) params.set('year', yearParam);
    if (fileNameParam) params.set('fileName', fileNameParam);
    router.replace(`/play?${params.toString()}`);
  }, [
    watchRoomContext?.currentRoom,
    router,
    sourceParam,
    idParam,
    titleParam,
    yearParam,
    fileNameParam,
  ]);

  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [preplay, setPreplay] = useState<number | null>(null);
  const [videoTick, setVideoTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [playing, setPlaying] = useState(true);
  const [fav, setFav] = useState(false);
  const [favPop, setFavPop] = useState(false);
  const [clean, setClean] = useState(false);
  const [speed, setSpeed] = useState(1);
  // 去广告：跟 play 页的「去广告」设置共用同一个键（localStorage: enable_blockad，默认开）。
  // 不是本页私有的开关，两页改一处另一处跟着变。
  const [adFilter, setAdFilter] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('enable_blockad', String(adFilter));
    }
  }, [adFilter]);
  const [expanded, setExpanded] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [speedsOpen, setSpeedsOpen] = useState(false);
  const [drawer, setDrawer] = useState<'' | 'ep' | 'src' | 'detail'>('');
  const [dlOpen, setDlOpen] = useState(false);
  const [toast, setToast] = useState('');

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [seekHold, setSeekHold] = useState(false);
  const [seekRatio, setSeekRatio] = useState(0);
  // 时长还没出来就拖动时：把比例记下来，等 loadedmetadata 再定位。
  // 否则松手那一刻 duration 还是 0，进度条会弹回开头，等元数据到了才被顶到续播点。
  const [pendingSeekRatio, setPendingSeekRatio] = useState<number | null>(null);
  // 当前集还没到可播状态（首次加载 / 卡顿缓冲）时给加载指示
  const [videoLoading, setVideoLoading] = useState(true);
  // 当前集画面的宽高比（0 = 还不知道）。短剧不全是竖的，有些源是横屏的。
  const [videoAr, setVideoAr] = useState(0);

  const [sources, setSources] = useState<SearchResult[]>([]);
  const [srcInfo, setSrcInfo] = useState<Record<string, SrcInfo>>({});
  const [recs, setRecs] = useState<SearchResult[]>([]);

  const [epPage, setEpPage] = useState(0);
  const [epDesc, setEpDesc] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});
  const animatingRef = useRef(false);
  const resetNoAnimRef = useRef(false);
  const preplayRef = useRef<number | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startY: number;
    moved: boolean;
    skip: boolean;
  }>({
    active: false,
    startY: 0,
    moved: false,
    skip: false,
  });
  const seekRef = useRef<HTMLDivElement | null>(null);
  const seekHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detailRef = useRef<SearchResult | null>(null);
  const episodeIndexRef = useRef(0);
  const pendingSeekRef = useRef(0);
  const pendingSeekRatioRef = useRef<number | null>(null);
  // 拖动/续播落点：视频真正到位前把进度条锁在这个位置。
  // 加载中设了 currentTime 不会马上有 timeupdate，条子会被上一次的 time 拉回原位，
  // 等数据到了才跳过去；锁住就不会来回跳。
  const seekTargetRef = useRef<{ t: number; until: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measuredRef = useRef(false);
  const customAdFilterCodeRef = useRef('');

  // 后台配置的自定义去广告代码：取一次，供 hls loader 每次请求读取
  useEffect(() => {
    let alive = true;
    void loadCustomAdFilterCode().then((code) => {
      if (alive) customAdFilterCodeRef.current = code;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  useEffect(() => {
    episodeIndexRef.current = episodeIndex;
  }, [episodeIndex]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 1500);
  }, []);

  /* 跳到 t：立刻把进度条按到位，并锁住直到视频真的到了附近（或 8 秒超时放弃）。
     加载中 currentTime 设下去不会马上回 timeupdate，光等事件条子会先弹回旧位置。 */
  const commitSeek = useCallback((t: number) => {
    seekTargetRef.current = { t, until: Date.now() + 8000 };
    setTime(t);
  }, []);

  const progressKey = useMemo(
    () =>
      detail
        ? buildEpisodeProgressContentKey({
            doubanId: detail.douban_id,
            tmdbId: detail.tmdb_id,
            title: detail.title,
            year: detail.year,
            searchType: 'tv',
          })
        : null,
    [detail]
  );

  /* ---------- 1. 拉详情 ---------- */
  useEffect(() => {
    if (!sourceParam || !idParam) {
      setError('缺少参数');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let url = appendSpecialSourceParam(
          `/api/source-detail?source=${encodeURIComponent(sourceParam)}&id=${encodeURIComponent(idParam)}&title=${encodeURIComponent(titleParam)}`
        );
        if (fileNameParam) url += `&fileName=${encodeURIComponent(fileNameParam)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('获取视频详情失败');
        const data = (await res.json()) as SearchResult;
        if (cancelled) return;
        if (!data || !Array.isArray(data.episodes) || data.episodes.length === 0) {
          throw new Error('未获取到剧集信息');
        }
        setDetail(data);
        setSources([data]);
        setSrcInfo({});
        measuredRef.current = false;
        setDrawer('');
        setSeekHold(false);
        setTime(0);
        setDuration(0);

        const contentTypeKey = buildEpisodeProgressContentKey({
          doubanId: data.douban_id,
          tmdbId: data.tmdb_id,
          title: data.title,
          year: data.year,
          searchType: 'tv',
        });

        // 初始集数：只有 URL 显式带了 episode（换源/指定集跳转）才算指定，
        // 否则回上次观看记录。注意不能用 Number(episodeParam) 直接判断——
        // 参数缺失时 Number(null)===0，会把「没指定」误判成「指定第 1 集」。
        let startIndex = 0;
        let startTime = 0;
        const forced =
          episodeParam !== null && episodeParam !== '' ? Number(episodeParam) : NaN;
        if (Number.isFinite(forced) && forced >= 0) {
          startIndex = Math.min(forced, data.episodes.length - 1);
          startTime = resumeTimeFor(contentTypeKey, startIndex);
        } else {
          try {
            const records = await getAllPlayRecords();
            const rec = records[generateStorageKey(data.source, data.id)];
            if (rec && rec.index >= 1 && rec.index <= data.episodes.length) {
              startIndex = rec.index - 1;
              // 全局记录也可能停在结尾附近，同样按「看完」规则从头开始
              startTime = tailResumeTime(rec.play_time || 0, rec.total_time || 0);
            }
          } catch {
            /* 忽略 */
          }
          if (!startTime) startTime = resumeTimeFor(contentTypeKey, startIndex);
        }
        pendingSeekRef.current = startTime > 2 ? startTime : 0;
        setEpisodeIndex(startIndex);
        // 触发当前集 video 重新绑定，好把续播位置应用上去
        setVideoTick((t) => t + 1);

        // 收藏态
        try {
          setFav(await isFavorited(data.source, data.id));
        } catch {
          /* 忽略 */
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceParam, idParam, titleParam, fileNameParam, episodeParam]);

  /* ---------- 2. 解析每一集的播放地址 ----------
     与 play 页内联播放的地址映射保持一致：
     - directplay：域名只能服务端拉，走 /api/proxy-m3u8
     - proxyMode 源：走 /api/proxy/vod/m3u8
     - 普通采集源：浏览器直连原始 m3u8（去广告由 hls.js loader 客户端做），
       另给一个 proxy-m3u8 备胎，直连失败（多为 CORS）时自动回退
     之前把普通源也一律塞进服务端代理，导致服务端拉不到的源在竖屏页播不了。 */
  const resolvedSources = useMemo(() => {
    const total = detail?.episodes?.length || 0;
    const out: Array<{ src: string; proxy?: string }> = [];
    const envToken = (process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN || '').trim();
    const tokenParam = envToken ? `&token=${encodeURIComponent(envToken)}` : '';
    const adblockParam = adFilter ? '' : '&adblock=false';
    for (let i = 0; i < total; i++) {
      const raw = detail?.episodes?.[i] || '';
      let src = raw;
      let proxy: string | undefined;
      if (raw && detail && /^https?:/i.test(raw)) {
        const isM3u8 =
          /\.m3u/i.test(raw) ||
          !/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/i.test(raw);
        if (detail.source === 'directplay' && isM3u8) {
          src = `/api/proxy-m3u8?url=${encodeURIComponent(raw)}&source=directplay${tokenParam}${adblockParam}`;
        } else if (detail.proxyMode && isM3u8) {
          src = `/api/proxy/vod/m3u8?url=${encodeURIComponent(raw)}&source=${encodeURIComponent(detail.source)}`;
        } else if (isM3u8) {
          proxy = `/api/proxy-m3u8?url=${encodeURIComponent(raw)}&source=${encodeURIComponent(detail.source)}${tokenParam}${adblockParam}`;
        }
      }
      out.push({ src, proxy });
    }
    return out;
  }, [detail, adFilter]);

  /* ---------- 3. 竖排轨道：按 -当前集*100% 平移，拖动时叠加手指位移 ---------- */
  const setTrack = useCallback((i: number, dx: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 300ms cubic-bezier(.2,.8,.25,1)' : 'none';
    el.style.transform = `translateY(calc(${-i * 100}% + ${dx}px))`;
  }, []);

  const setTrackEl = useCallback((el: HTMLDivElement | null) => {
    trackRef.current = el;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateY(calc(${-episodeIndexRef.current * 100}% + 0px))`;
    }
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (animatingRef.current || dragRef.current.active) return;
      setTrack(episodeIndexRef.current, 0, false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setTrack]);

  const registerVideo = useCallback((ep: number, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current[ep] = el;
    else delete videoRefs.current[ep];
    setVideoTick((t) => t + 1);
  }, []);

  /* ---------- 4. 进度保存 ---------- */
  const saveCurrentProgress = useCallback(() => {
    const d = detailRef.current;
    const v = videoRefs.current[episodeIndexRef.current];
    if (!d || !v) return;
    const t = v.currentTime || 0;
    const total = v.duration || 0;
    if (!(t > 1) || !(total > 0)) return;
    const key = buildEpisodeProgressContentKey({
      doubanId: d.douban_id,
      tmdbId: d.tmdb_id,
      title: d.title,
      year: d.year,
      searchType: 'tv',
    });
    const idx = episodeIndexRef.current;
    saveLocalEpisodeProgress(key, idx, t, total);
    void savePlayRecord(d.source, d.id, {
      title: d.title,
      source_name: d.source_name,
      cover: d.poster,
      year: d.year,
      index: idx + 1,
      total_episodes: d.episodes?.length || 0,
      play_time: t,
      total_time: total,
      save_time: Date.now(),
      search_title: titleParam || d.title,
      is_duanju: true,
    });
  }, [titleParam]);

  useEffect(() => {
    const timer = setInterval(() => saveCurrentProgress(), 5000);
    const onHide = () => saveCurrentProgress();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      onHide();
    };
  }, [saveCurrentProgress]);

  /* ---------- 5. 切集：相邻集滑动过渡，远端跳转直接定位 ---------- */
  const goEpisode = useCallback(
    (next: number) => {
      const d = detailRef.current;
      if (!d || !d.episodes) return;
      if (animatingRef.current) return;
      const total = d.episodes.length;
      const from = episodeIndexRef.current;
      const to = Math.max(0, Math.min(total - 1, next));
      if (to === from) return;
      setDrawer('');

      const key = buildEpisodeProgressContentKey({
        doubanId: d.douban_id,
        tmdbId: d.tmdb_id,
        title: d.title,
        year: d.year,
        searchType: 'tv',
      });
      saveCurrentProgress();
      pendingSeekRef.current = resumeTimeFor(key, to);
      pendingSeekRatioRef.current = null;
      setPendingSeekRatio(null);
      seekTargetRef.current = null;

      const h = trackRef.current?.clientHeight || window.innerHeight;

      if (Math.abs(to - from) !== 1) {
        // 选集抽屉直接跳集：不做滑动
        resetNoAnimRef.current = true;
        setEpisodeIndex(to);
        return;
      }

      // 相邻集：目标集先起播，滑到位再提交
      const dir = to > from ? 1 : -1;
      animatingRef.current = true;
      preplayRef.current = to;
      setPreplay(to);
      setTrack(from, dir * -h, true);
      window.setTimeout(() => {
        resetNoAnimRef.current = true;
        preplayRef.current = null;
        setPreplay(null);
        setEpisodeIndex(to);
        animatingRef.current = false;
      }, 300);
    },
    [saveCurrentProgress, setTrack]
  );
  const goEpisodeRef = useRef(goEpisode);
  useEffect(() => {
    goEpisodeRef.current = goEpisode;
  }, [goEpisode]);

  // 集号变化后把轨道对到该集（这一帧关掉过渡：动画收尾时正好落在此处，不会闪）
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(calc(${-episodeIndex * 100}% + 0px))`;
    resetNoAnimRef.current = false;
    requestAnimationFrame(() => {
      if (trackRef.current) {
        trackRef.current.style.transition = 'transform 300ms cubic-bezier(.2,.8,.25,1)';
      }
    });
  }, [episodeIndex]);

  // 当前集的 video：绑事件 / 应用续播 / 同步进度与播放态
  useEffect(() => {
    const v = videoRefs.current[episodeIndex];
    if (!v) return;
    const boundAt = Date.now();
    const seekTo = (t: number) => {
      try {
        v.currentTime = t;
      } catch {
        /* noop */
      }
      commitSeek(t);
    };
    const applyResume = () => {
      // 加载中拖过的位置优先于续播点：用户明确指到哪儿就去哪儿
      const ratio = pendingSeekRatioRef.current;
      if (ratio != null && Number.isFinite(v.duration) && v.duration > 0) {
        pendingSeekRatioRef.current = null;
        setPendingSeekRatio(null);
        seekTo(ratio * v.duration);
        return;
      }
      const target = pendingSeekRef.current;
      if (target > 1) {
        pendingSeekRef.current = 0;
        if (Number.isFinite(v.duration) && target < v.duration) seekTo(target);
      }
    };
    const onTime = () => {
      const now = v.currentTime || 0;
      const lock = seekTargetRef.current;
      // 锁着的时候：视频到了落点附近（或超时）就解开跟随，否则保持落点不动
      if (lock) {
        if (Math.abs(now - lock.t) <= 1 || Date.now() > lock.until) {
          seekTargetRef.current = null;
          setTime(now);
        }
      } else {
        setTime(now);
      }
      setDuration(v.duration || 0);
    };
    // 画面比例会决定「机位框」多宽（竖屏 9:16 / 横屏按视频自己），
    // HLS 中途切码率也可能换分辨率，所以 resize 也要跟着更新
    const syncAr = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setVideoAr(v.videoWidth / v.videoHeight);
      }
    };
    const onMeta = () => {
      setDuration(v.duration || 0);
      syncAr();
      applyResume();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // 加载指示：等 waiting 亮、能播了灭。readyState 已经够的（划回来的一集）不闪。
    // 能播时再对一次落点：加载期间设的 currentTime 可能被 hls 起播冲掉。
    const onWaiting = () => setVideoLoading(true);
    const onReady = () => {
      setVideoLoading(false);
      const lock = seekTargetRef.current;
      if (
        lock &&
        Number.isFinite(v.duration) &&
        v.duration > 0 &&
        Math.abs((v.currentTime || 0) - lock.t) > 1
      ) {
        try {
          v.currentTime = lock.t;
        } catch {
          /* noop */
        }
      }
    };
    const onEnded = () => {
      setVideoLoading(false);
      const total = detailRef.current?.episodes?.length || 0;
      // 刚切到这一集就 ended（多半是划回上一集时它的播放头还停在末尾）：
      // 从头重播，别顺延下一集，否则看起来就是「切回去又跳走」。
      if (Date.now() - boundAt < 1500) {
        try {
          v.currentTime = 0;
        } catch {
          /* noop */
        }
        v.play().catch(() => {});
        return;
      }
      if (episodeIndexRef.current < total - 1) {
        // 先把「看到末尾」记下来，再把这一集的播放头挪回开头，
        // 否则划回来时会停在末尾、一播就 again ended 又跳下一集
        saveCurrentProgress();
        try {
          v.currentTime = 0;
        } catch {
          /* noop */
        }
        goEpisodeRef.current(episodeIndexRef.current + 1);
      } else {
        setPlaying(false);
      }
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('resize', syncAr);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onReady);
    v.addEventListener('canplay', onReady);
    v.addEventListener('error', onReady);
    setTime(seekTargetRef.current?.t ?? v.currentTime ?? 0);
    setDuration(v.duration || 0);
    setPlaying(!v.paused);
    setVideoLoading(v.readyState < 3);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('resize', syncAr);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onReady);
      v.removeEventListener('canplay', onReady);
      v.removeEventListener('error', onReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeIndex, videoTick]);

  // 播放控制：当前集 + 正滑入的一集 播放，其余暂停
  useEffect(() => {
    const total = detailRef.current?.episodes?.length || 0;
    Object.keys(videoRefs.current).forEach((k) => {
      const ep = Number(k);
      const v = videoRefs.current[ep];
      if (!v) return;
      if ((ep === episodeIndex || ep === preplay) && ep >= 0 && ep < total) {
        // 已经播到末尾的（含刚 ended 被划回来的）从头开始，否则会一 play 就 ended
        if (
          v.ended ||
          (Number.isFinite(v.duration) &&
            v.duration > 0 &&
            v.currentTime >= v.duration - 1.5)
        ) {
          try {
            v.currentTime = 0;
          } catch {
            /* noop */
          }
        }
        try {
          v.playbackRate = speed;
        } catch {
          /* noop */
        }
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, [episodeIndex, preplay, speed, videoTick]);

  /* ---------- 5. 其它源（换源）与推荐 ---------- */
  const searchTitle = titleParam || detail?.title || '';
  useEffect(() => {
    if (!detail || !searchTitle) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          appendSpecialSourceParam(`/api/search?q=${encodeURIComponent(searchTitle)}`)
        );
        if (!res.ok) return;
        const data = await res.json();
        const list: SearchResult[] = Array.isArray(data?.results) ? data.results : [];
        if (cancelled) return;
        const related = list.filter(
          (r) =>
            r.episodes?.length > 0 &&
            (r.title === detail.title ||
              r.title.includes(detail.title) ||
              detail.title.includes(r.title))
        );
        setSources([
          detail,
          ...related.filter((r) => !(r.source === detail.source && r.id === detail.id)),
        ]);
      } catch {
        /* 保留当前源 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, searchTitle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/duanju/recommends');
        if (!res.ok) return;
        const data = await res.json();
        const list: SearchResult[] = Array.isArray(data?.data) ? data.data : [];
        if (cancelled) return;
        setRecs(list.filter((r) => !(r.source === sourceParam && r.id === idParam)).slice(0, 9));
      } catch {
        /* 忽略 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceParam, idParam]);

  /* 逐个源跑测速（并发 3），像 play 页那样 */
  const measureSources = useCallback(async (list: SearchResult[]) => {
    const keyOf = (s: SearchResult) => `${s.source}-${s.id}`;
    setSrcInfo((prev) => {
      const next = { ...prev };
      list.forEach((s) => {
        if (!next[keyOf(s)]) next[keyOf(s)] = { state: 'measuring' };
      });
      return next;
    });

    const queue = list.slice();
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        if (!s) break;
        const url = s.episodes?.[0];
        if (!url || !/^https?:/i.test(url)) {
          setSrcInfo((p) => ({ ...p, [keyOf(s)]: { state: 'error', label: '无法测速' } }));
          continue;
        }
        try {
          const info = await getVideoResolutionFromM3u8(url, 6000);
          setSrcInfo((p) => ({
            ...p,
            [keyOf(s)]: {
              state: 'done',
              quality: info.quality,
              speed: info.loadSpeed,
              ping: info.pingTime,
              bitrate: info.bitrate,
            },
          }));
        } catch (e) {
          const t = (e as { type?: string })?.type;
          setSrcInfo((p) => ({
            ...p,
            [keyOf(s)]: { state: 'error', label: t === 'timeout' ? '超时' : '无法访问' },
          }));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }, []);

  const openSrcDrawer = useCallback(() => {
    setDrawer('src');
    if (!measuredRef.current) {
      measuredRef.current = true;
      void measureSources(sources);
    }
  }, [sources, measureSources]);

  /* ---------- 收藏 / 清屏 / 倍速 / 去广告 ---------- */
  const toggleFav = useCallback(async () => {
    const d = detailRef.current;
    if (!d) return;
    const next = !fav;
    setFav(next);
    setFavPop(true);
    setTimeout(() => setFavPop(false), 360);
    try {
      if (next) {
        await saveFavorite(d.source, d.id, {
          title: d.title,
          source_name: d.source_name,
          year: d.year,
          cover: d.poster,
          total_episodes: d.episodes?.length || 0,
          save_time: Date.now(),
          search_title: titleParam || d.title,
        });
        showToast('已收藏');
      } else {
        await deleteFavorite(d.source, d.id);
        showToast('已取消收藏');
      }
    } catch {
      setFav(!next);
      showToast('操作失败');
    }
  }, [fav, titleParam, showToast]);

  const toggleClean = useCallback(() => {
    setClean((v) => !v);
  }, []);

  /* ---------- 全屏 ---------- */
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const doc = document as any;
    const onChange = () =>
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    onChange();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = document.getElementById('djplayer') as any;
    if (!el) return;
    const doc = document as any;
    const current = doc.fullscreenElement || doc.webkitFullscreenElement;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      if (current) {
        exit?.call(doc);
      } else if (request) {
        const p = request.call(el);
        // 老 webkit 的 request* 返回 undefined，新的是 Promise
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      // 既没进过全屏、又没有 API（如 iOS 上的老 WebView）：什么都不做
    } catch {
      /* noop */
    }
  }, []);

  const applySpeed = useCallback((v: number) => {
    setSpeed(v);
    Object.values(videoRefs.current).forEach((el) => {
      if (!el) return;
      try {
        el.playbackRate = v;
      } catch {
        /* noop */
      }
    });
  }, []);

  const togglePlay = useCallback(() => {
    const v =
      videoRefs.current[episodeIndexRef.current] ||
      (preplayRef.current != null ? videoRefs.current[preplayRef.current] : null);
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  /* ---------- 导航 ---------- */
  const goBack = useCallback(() => {
    saveCurrentProgress();
    if (window.history.length > 1) router.back();
    else router.push('/duanju');
  }, [router, saveCurrentProgress]);

  const navigateTo = useCallback(
    (s: SearchResult, episodeIdx?: number) => {
      saveCurrentProgress();
      setDrawer('');
      const p = new URLSearchParams({ source: s.source, id: s.id, title: s.title });
      const y = s.year || '';
      if (y) p.set('year', y);
      if (typeof episodeIdx === 'number') p.set('episode', String(episodeIdx));
      router.push(`/duanju/play?${p.toString()}`);
    },
    [router, saveCurrentProgress]
  );

  const backToNormalPlayer = useCallback(() => {
    saveCurrentProgress();
    const p = new URLSearchParams();
    if (sourceParam) p.set('source', sourceParam);
    if (idParam) p.set('id', idParam);
    if (titleParam) p.set('title', titleParam);
    if (yearParam) p.set('year', yearParam);
    if (fileNameParam) p.set('fileName', fileNameParam);
    router.push(`/play?${p.toString()}`);
  }, [router, saveCurrentProgress, sourceParam, idParam, titleParam, yearParam, fileNameParam]);

  /* ---------- 下载 ---------- */
  const handleDownload = useCallback(
    async (indexes: number[]) => {
      const d = detailRef.current;
      if (!d || !d.episodes || indexes.length === 0) return;
      let ok = 0;
      for (const i of indexes) {
        const raw = d.episodes[i];
        if (!raw) continue;
        try {
          if (/\.m3u8/i.test(raw) || raw.includes('/api/proxy')) {
            await addDownloadTask(raw, `${d.title}_第${i + 1}集`, 'TS', {
              source: d.source,
              videoId: d.id,
              episodeIndex: i,
            });
          } else {
            const a = document.createElement('a');
            a.href = raw;
            a.download = `${d.title}_第${i + 1}集.mp4`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            await new Promise((r) => setTimeout(r, 250));
          }
          ok += 1;
        } catch {
          /* 跳过 */
        }
      }
      showToast(ok > 0 ? `已添加 ${ok} 个下载任务` : '下载失败，请重试');
    },
    [addDownloadTask, showToast]
  );

  /* ---------- 进度条拖拽 ---------- */
  const pct =
    duration > 0
      ? (seeking ? seekRatio : time / duration) * 100
      : seeking
        ? seekRatio * 100
        : pendingSeekRatio != null
          ? pendingSeekRatio * 100
          : 0;
  const seekDisplayTime = seeking ? seekRatio * duration : time;

  const ratioFromX = useCallback((clientX: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  const onSeekDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (seekHoldTimerRef.current) clearTimeout(seekHoldTimerRef.current);
      setSeekHold(true);
      setSeeking(true);
      setSeekRatio(ratioFromX(e.clientX));
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    },
    [ratioFromX]
  );
  const onSeekMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seeking) return;
      setSeekRatio(ratioFromX(e.clientX));
    },
    [seeking, ratioFromX]
  );
  const onSeekUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seeking) return;
      const ratio = ratioFromX(e.clientX);
      const v = videoRefs.current[episodeIndexRef.current];
      if (v && duration > 0) {
        // 立刻记下落点：设完 currentTime 不会马上有 timeupdate，
        // 不锁住的话条子会先弹回旧位置、等数据到了才跳过去
        const t = ratio * duration;
        try {
          v.currentTime = t;
        } catch {
          /* noop */
        }
        commitSeek(t);
        pendingSeekRatioRef.current = null;
        setPendingSeekRatio(null);
      } else {
        // 时长还没出来（元数据未到）：先记住落点，bar 停在手指松开的地方，
        // loadedmetadata 时再真正定位
        pendingSeekRatioRef.current = ratio;
        setPendingSeekRatio(ratio);
      }
      setSeeking(false);
      // 拖完让时间多留一会儿，点一下（非拖动）也看得清
      if (seekHoldTimerRef.current) clearTimeout(seekHoldTimerRef.current);
      seekHoldTimerRef.current = setTimeout(() => setSeekHold(false), 320);
    },
    [seeking, ratioFromX, duration]
  );

  /* ---------- 手势：手指拖动跟着走，松手越过阈值就滑到相邻集 ---------- */
  const onTouchDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('.seek, .menu')) return;
    dragRef.current = {
      active: true,
      startY: e.clientY,
      moved: false,
      skip: !!t.closest('.rail, .bottom, .top, .menu, .seek, .drawer'),
    };
    // 这里**不能** setPointerCapture：鼠标按下就捕获的话，pointerup 被改派到
    // touchguard，click 会落到 mousedown/up 的公共祖先（也就是 touchguard）上，
    // 按钮自己的 onClick 永远收不到——PC 上整个页面的按钮全点不动（触屏是浏览器
    // 另外合成的 click，所以只有 PC 中招）。等真的拖起来了再捕获。
  }, []);

  const onTouchMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dy = e.clientY - d.startY;
      if (Math.abs(dy) > 6) d.moved = true;
      // 开始拖了才捕获指针：拖出元素范围也能继续跟手
      if (d.moved) {
        try {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        } catch {
          /* noop */
        }
      }
      const idx = episodeIndexRef.current;
      const total = detailRef.current?.episodes?.length || 0;
      const atEdge = (dy < 0 && idx >= total - 1) || (dy > 0 && idx <= 0);
      setTrack(idx, atEdge ? dy * 0.28 : dy, false);
    },
    [setTrack]
  );

  const onTouchCancel = useCallback(() => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    setTrack(episodeIndexRef.current, 0, true);
  }, [setTrack]);

  const onTouchUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      const dy = e.clientY - d.startY;
      const h = trackRef.current?.clientHeight || window.innerHeight;
      const threshold = Math.min(96, h * 0.14);
      const idx = episodeIndexRef.current;
      const total = detailRef.current?.episodes?.length || 0;
      const to = idx + (dy < 0 ? 1 : -1);
      if (Math.abs(dy) > threshold && to >= 0 && to < total) {
        goEpisode(to);
        return;
      }
      setTrack(idx, 0, true);
      if (!d.moved && !d.skip) {
        setMenuOpen(false);
        togglePlay();
      }
    },
    [goEpisode, setTrack, togglePlay]
  );

  useEffect(() => {
    const root = document.getElementById('djplayer');
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.seek, .menu, .drawer')) return;
      if (drawer) return;
      e.preventDefault();
      goEpisodeRef.current(episodeIndexRef.current + (e.deltaY > 0 ? 1 : -1));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dlOpen) {
        if (e.key === 'Escape') setDlOpen(false);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        goEpisodeRef.current(episodeIndexRef.current + 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        goEpisodeRef.current(episodeIndexRef.current - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFav();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        toggleClean();
      } else if (e.key === 'Escape') {
        setDrawer('');
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dlOpen, togglePlay, toggleFav, toggleClean]);

  /* ---------- 派生 ---------- */
  const total = detail?.episodes?.length || 0;
  const epNo = episodeIndex + 1;
  const pageCount = Math.max(1, Math.ceil(total / EP_PER_PAGE));
  const dispPage = epDesc ? pageCount - 1 - epPage : epPage;
  const pageStart = dispPage * EP_PER_PAGE;
  const pageEnd = Math.min(pageStart + EP_PER_PAGE - 1, total - 1);
  const gridEpisodes = useMemo(() => {
    const arr: number[] = [];
    for (let k = 0; k <= pageEnd - pageStart; k++) {
      arr.push(epDesc ? pageEnd - k + 1 : pageStart + k + 1);
    }
    return arr;
  }, [pageStart, pageEnd, epDesc]);

  const currentKey = `${sourceParam}-${idParam}`;

  if (error) {
    return (
      <div className='fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black px-8 text-center text-gray-300'>
        <p>{error}</p>
        <button
          onClick={goBack}
          className='rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-black'
        >
          返回
        </button>
      </div>
    );
  }

  // 画面宽高比决定「手机屏」多宽：竖屏短剧 9:16（cover 铺满）；
  // 比 9:16 还宽的画面（横屏短剧、方屏）按视频自身比例定宽 + contain 完整显示。
  const TALL_AR = 9 / 16;
  const videoWide = videoAr > TALL_AR;
  const frameNum = videoWide ? Math.min(videoAr, 4) : TALL_AR;

  return (
    <div
      id='djplayer'
      className={`${clean ? 'clean' : ''} ${playing ? '' : 'paused'} ${loading || videoLoading ? 'loading' : ''}${videoWide ? ' fit' : ''}`}
      style={{ '--col-num': String(frameNum) } as React.CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: LOCAL_CSS }} />

      <div
        className='touchguard'
        onPointerDown={onTouchDown}
        onPointerMove={onTouchMove}
        onPointerUp={onTouchUp}
        onPointerCancel={onTouchCancel}
      >
        {/* 播放层：竖排轨道，当前集 + 上下相邻集常驻，拖动整条跟手 */}
        <div className='stage'>
          <div className='track' ref={setTrackEl}>
            {[episodeIndex - 1, episodeIndex, episodeIndex + 1]
              .filter((ep) => ep >= 0 && ep < total)
              .map((ep) => (
                <div
                  key={ep}
                  className='eslot'
                  style={{ transform: `translateY(${ep * 100}%)` }}
                >
                  <EpisodeSlide
                    ep={ep}
                    url={resolvedSources[ep]?.src || ''}
                    proxyUrl={resolvedSources[ep]?.proxy}
                    adFilter={adFilter}
                    source={detail?.source || ''}
                    customCodeRef={customAdFilterCodeRef}
                    shouldPlay={ep === episodeIndex || ep === preplay}
                    speed={speed}
                    register={registerVideo}
                    onFatal={() => {
                      // 源彻底拉不动了，别再转圈
                      setVideoLoading(false);
                      showToast('播放失败，可尝试换源');
                    }}
                  />
                </div>
              ))}
          </div>
        </div>

        {(loading || videoLoading) && (
          <div className='absolute inset-0 z-[2] flex items-center justify-center'>
            <span className='h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white/80' />
          </div>
        )}

        {/* 顶栏 */}
        <div className='top'>
          <button className='iconbtn' title='返回' aria-label='返回' onClick={goBack}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M15 18l-6-6 6-6' />
            </svg>
          </button>
          <span className='name'>{detail?.title || titleParam || '短剧'}</span>
          <button
            className='iconbtn'
            title='更多'
            aria-label='更多'
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
              setSpeedsOpen(false);
            }}
          >
            <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
              <circle cx='5' cy='12' r='1.8' />
              <circle cx='12' cy='12' r='1.8' />
              <circle cx='19' cy='12' r='1.8' />
            </svg>
          </button>
        </div>

        {/* 更多菜单 */}
        <div className={`menu ${menuOpen ? 'on' : ''}`} role='menu' onClick={(e) => e.stopPropagation()}>
          <button className='mrow' role='menuitem' onClick={() => setSpeedsOpen((v) => !v)}>
            <span>倍速</span>
            <span className='val'>{fmtSpeed(speed)}x</span>
          </button>
          <div className={`speeds ${speedsOpen ? 'on' : ''}`}>
            {SPEEDS.map((s) => (
              <button key={s} className={s === speed ? 'cur' : ''} onClick={() => applySpeed(s)}>
                {fmtSpeed(s)}x
              </button>
            ))}
          </div>
          <button
            className='mrow'
            role='menuitem'
            onClick={() => {
              setMenuOpen(false);
              setDlOpen(true);
            }}
          >
            <span>下载</span>
          </button>
          <button
            className='mrow'
            role='menuitem'
            onClick={() => {
              const next = !adFilter;
              setAdFilter(next);
              showToast(next ? '已开启去广告' : '已关闭去广告');
            }}
          >
            <span>去广告</span>
            <span className={`sw ${adFilter ? 'on' : ''}`} />
          </button>
          <div className='mdiv' />
          <button
            className='mrow'
            role='menuitem'
            onClick={() => {
              setMenuOpen(false);
              backToNormalPlayer();
            }}
          >
            <span>回到普通播放页</span>
          </button>
        </div>

        <div className={`toast ${toast ? 'on' : ''}`}>{toast}</div>

        {/* 中央播放态 */}
        <div className='center'>
          <div className='bigplay'>
            <svg width='30' height='30' viewBox='0 0 24 24' fill='currentColor'>
              <path d='M8 5v14l11-7z' />
            </svg>
          </div>
        </div>

        {/* 右侧操作列：收藏 + 换源 */}
        <div className='rail'>
          <button
            className={`railbtn ${fav ? 'on' : ''} ${favPop ? 'pop' : ''}`}
            title='收藏'
            aria-pressed={fav}
            aria-label='收藏'
            onClick={toggleFav}
          >
            <span className='bubble'>
              <svg width='22' height='22' viewBox='0 0 24 24' fill={fav ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z' />
              </svg>
            </span>
            <span className='lab'>{fav ? '已收藏' : '收藏'}</span>
          </button>
          <button className='railbtn' title='换源' aria-label='换源' onClick={openSrcDrawer}>
            <span className='bubble'>
              <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M3 12a9 9 0 0 1 15-6.7L21 8' />
                <path d='M21 3v5h-5' />
                <path d='M21 12a9 9 0 0 1-15 6.7L3 16' />
                <path d='M3 21v-5h5' />
              </svg>
              {sources.length > 0 && <span className='badge'>{sources.length}</span>}
            </span>
            <span className='lab'>换源</span>
          </button>
        </div>

        {/* 底部 */}
        <div className='bottom' onClick={(e) => e.stopPropagation()}>
          <div className={`info ${seeking || seekHold ? 'seeking' : ''}`}>
            <button className='vt' aria-label='查看详情' onClick={() => setDrawer('detail')}>
              <span className='t'>{detail?.title || titleParam || '短剧'}</span>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M9 6l6 6-6 6' />
              </svg>
            </button>
            {detail?.desc && (
              <button
                className={`desc ${expanded ? 'expanded' : ''}`}
                aria-expanded={expanded}
                aria-label={expanded ? '收起简介' : '展开简介'}
                onClick={() => setExpanded((v) => !v)}
              >
                <span className='dtext'>{detail.desc}</span>
              </button>
            )}
            <div className='seektime'>
              <b>{clock(seekDisplayTime)}</b>
              <span className='sep'>/</span>
              <span className='tot'>{clock(duration)}</span>
            </div>
          </div>

          <div
            className={`seek ${seeking ? 'seeking' : ''}`}
            ref={seekRef}
            onPointerDown={onSeekDown}
            onPointerMove={onSeekMove}
            onPointerUp={onSeekUp}
            onPointerCancel={onSeekUp}
          >
            <div className='bar'>
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className='thumb' style={{ left: `${pct}%` }} />
          </div>

          <div className='epblock'>
            <button className='eplab' aria-label='选集' onClick={() => setDrawer('ep')}>
              <span className='ep'>
                第 <em>{epNo}</em> 集 / 共 <em>{total}</em> 集
              </span>
            </button>
            <button
              className={`clearbtn ${clean ? 'on' : ''}`}
              title={clean ? '退出清屏' : '清屏'}
              aria-label='清屏'
              aria-pressed={clean}
              onClick={toggleClean}
            >
              <svg className='icon-off' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M3 3l18 18' />
                <path d='M10.6 10.6a2 2 0 0 0 2.8 2.8' />
                <path d='M9.4 5.3A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1' />
                <path d='M6.2 6.2C4.2 7.6 3 9.5 3 12c0 2.5 4 7 9 7 1.6 0 3-.4 4.2-1' />
              </svg>
              <svg className='icon-on' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z' />
                <circle cx='12' cy='12' r='3' />
              </svg>
            </button>
            <button
              className='fsbtn'
              title={isFullscreen ? '退出全屏' : '全屏'}
              aria-label={isFullscreen ? '退出全屏' : '全屏'}
              aria-pressed={isFullscreen}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <path d='M3 8h3a2 2 0 0 0 2-2V3' />
                  <path d='M21 8h-3a2 2 0 0 1-2-2V3' />
                  <path d='M3 16h3a2 2 0 0 1 2 2v3' />
                  <path d='M21 16h-3a2 2 0 0 0-2 2v3' />
                </svg>
              ) : (
                <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <path d='M8 3H5a2 2 0 0 0-2 2v3' />
                  <path d='M16 3h3a2 2 0 0 1 2 2v3' />
                  <path d='M8 21H5a2 2 0 0 1-2-2v-3' />
                  <path d='M16 21h3a2 2 0 0 0 2-2v-3' />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 遮罩 + 抽屉 */}
      <div className={`scrim ${drawer ? 'on' : ''}`} onClick={() => setDrawer('')} />

      {/* 选集 */}
      <div className={`drawer ${drawer === 'ep' ? 'on' : ''}`} role='dialog' aria-label='选集' aria-modal='true'>
        <div className='grab' />
        <div className='dhead'>
          <span className='dtitle'>选集</span>
          <span className='dsub'>共 {total} 集</span>
          <button className='dclose' aria-label='关闭' onClick={() => setDrawer('')}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'>
              <path d='M6 6l12 12M18 6L6 18' />
            </svg>
          </button>
        </div>
        <div className='dbody'>
          <div className='grpbar'>
            <div className='ranges'>
              {Array.from({ length: pageCount }).map((_, p) => {
                const s = p * EP_PER_PAGE + 1;
                const e = Math.min(s + EP_PER_PAGE - 1, total);
                return (
                  <button
                    key={p}
                    className={p === dispPage ? 'cur' : ''}
                    onClick={() => setEpPage(p)}
                  >
                    {epDesc ? `${e}-${s}` : `${s}-${e}`}
                  </button>
                );
              })}
            </div>
            <button className='flip' title='切换排序' aria-label='切换排序' onClick={() => setEpDesc((v) => !v)}>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4' />
              </svg>
            </button>
          </div>
          <div className='epgrid'>
            {gridEpisodes.map((n) => (
              <button
                key={n}
                className={`epcell ${n === epNo ? 'cur' : ''} ${n < epNo ? 'watched' : ''}`}
                onClick={() => goEpisode(n - 1)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 换源 */}
      <div className={`drawer ${drawer === 'src' ? 'on' : ''}`} role='dialog' aria-label='换源' aria-modal='true'>
        <div className='grab' />
        <div className='dhead'>
          <span className='dtitle'>换源</span>
          <span className='dsub'>{detail?.source_name || ''}</span>
          <button
            className='retest'
            onClick={() => {
              setSrcInfo({});
              void measureSources(sources);
            }}
          >
            全部重测
          </button>
          <button className='dclose' aria-label='关闭' onClick={() => setDrawer('')}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'>
              <path d='M6 6l12 12M18 6L6 18' />
            </svg>
          </button>
        </div>
        <div className='dbody'>
          {sources.map((s) => {
            const key = `${s.source}-${s.id}`;
            const info = srcInfo[key];
            const isCur = key === currentKey;
            return (
              <button
                key={key}
                className={`srcrow ${isCur ? 'cur' : ''}`}
                onClick={() => {
                  if (isCur) {
                    setDrawer('');
                    return;
                  }
                  navigateTo(s, episodeIndexRef.current);
                }}
              >
                <span className='tick'>
                  <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3.4' strokeLinecap='round' strokeLinejoin='round'>
                    <path d='M20 6L9 17l-5-5' />
                  </svg>
                </span>
                <span className='meta'>
                  <span className='srtop'>
                    {info?.state === 'done' && (
                      <span className={`qn ${qualityLabel(info.quality)}`}>{info.quality}</span>
                    )}
                    <span className='sn'>{s.source_name || s.source}</span>
                    <span className='cnt'>{s.episodes?.length || 0} 集</span>
                  </span>
                  {!info || info.state === 'measuring' ? (
                    <span className='stats measuring'>测速中…</span>
                  ) : info.state === 'error' ? (
                    <span className='stats'>
                      <span className='err'>{info.label}</span>
                    </span>
                  ) : (
                    <span className='stats'>
                      <span className='sp'>{info.speed}</span>
                      <span className='pg'>{info.ping}ms</span>
                      <span className='br'>{info.bitrate}</span>
                    </span>
                  )}
                </span>
                <span className='tag'>{isCur ? '当前' : '切换'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 详情 */}
      <div className={`drawer ${drawer === 'detail' ? 'on' : ''}`} role='dialog' aria-label='剧集详情' aria-modal='true'>
        <div className='grab' />
        <div className='dhead'>
          <span className='dtitle'>剧集详情</span>
          <button className='dclose' aria-label='关闭' onClick={() => setDrawer('')}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'>
              <path d='M6 6l12 12M18 6L6 18' />
            </svg>
          </button>
        </div>
        <div className='dbody'>
          <div className='dhero'>
            <div className='dposter'>
              {detail?.poster && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={detail.poster} alt={detail.title} />
              )}
            </div>
            <div>
              <h3 className='dname'>{detail?.title}</h3>
              <div className='dtags'>
                {detail?.type_name && <span>{detail.type_name}</span>}
                {detail?.year && <span>{detail.year}</span>}
                <span>共 {total} 集</span>
              </div>
            </div>
          </div>
          <p className='dintro'>{detail?.desc || '暂无简介'}</p>
          {recs.length > 0 && (
            <>
              <div className='dsect'>更多推荐</div>
              <div className='drecs'>
                {recs.map((r) => (
                  <button key={`${r.source}-${r.id}`} className='rec' onClick={() => navigateTo(r, 0)}>
                    <span className='recpic'>
                      {r.poster && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={r.poster} alt={r.title} loading='lazy' />
                      )}
                    </span>
                    <span className='rect'>{r.title}</span>
                    <span className='rece'>{(r.year || '') + ' · 共 ' + (r.episodes?.length || 0) + ' 集'}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 下载（直接复用 play 页既有的下载选集面板） */}
      <DownloadEpisodeSelector
        isOpen={dlOpen}
        onClose={() => setDlOpen(false)}
        totalEpisodes={total}
        episodesTitles={detail?.episodes_titles || []}
        videoTitle={detail?.title || titleParam}
        currentEpisodeIndex={episodeIndex}
        onDownload={handleDownload}
      />
    </div>
  );
}

function DuanjuPlayFallback() {
  return (
    <div className='fixed inset-0 flex items-center justify-center bg-black'>
      <span className='h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white/80' />
    </div>
  );
}

export default function DuanjuPlayPage() {
  return (
    <Suspense fallback={<DuanjuPlayFallback />}>
      <DuanjuPlayClient />
    </Suspense>
  );
}
