'use client';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Home,
  Menu,
  Power,
  RotateCcw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { fireTVRemoteKey } from '@/lib/tv-remote-core';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none'
  );
}

function getScopedFocusableElements() {
  const scope = document.querySelector<HTMLElement>(
    '[data-tv-focus-scope="active"]'
  );
  if (scope) {
    return Array.from(scope.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.closest('[data-tv-remote]'))
      .filter((element) => !element.closest('[data-tv-no-focus="true"]'))
      .filter(isVisible);
  }

  return null;
}

function getFocusableElements() {
  const scopedElements = getScopedFocusableElements();
  if (scopedElements) {
    return Array.from(
      new Set([...getTopNavigationElements(), ...scopedElements])
    );
  }

  return Array.from(document.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.closest('[data-tv-remote]'))
    .filter((element) => !element.closest('[data-tv-no-focus="true"]'))
    .filter(isVisible);
}

function getScrollableParent(element: HTMLElement) {
  let current = element.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScrollY =
      /(auto|scroll)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight;
    const canScrollX =
      /(auto|scroll)/.test(style.overflowX) &&
      current.scrollWidth > current.clientWidth;
    if (canScrollY || canScrollX) return current;
    current = current.parentElement;
  }
  return null;
}

function scrollIntoScrollableParent(element: HTMLElement) {
  const parent = getScrollableParent(element);
  if (!parent) return false;

  const elementRect = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const padding = 16;

  if (elementRect.top < parentRect.top + padding) {
    parent.scrollBy({
      top: elementRect.top - parentRect.top - padding,
      behavior: 'smooth',
    });
  } else if (elementRect.bottom > parentRect.bottom - padding) {
    parent.scrollBy({
      top: elementRect.bottom - parentRect.bottom + padding,
      behavior: 'smooth',
    });
  }

  if (elementRect.left < parentRect.left + padding) {
    parent.scrollBy({
      left: elementRect.left - parentRect.left - padding,
      behavior: 'smooth',
    });
  } else if (elementRect.right > parentRect.right - padding) {
    parent.scrollBy({
      left: elementRect.right - parentRect.right + padding,
      behavior: 'smooth',
    });
  }

  return true;
}

function isTopNavigationElement(element: HTMLElement) {
  return Boolean(element.closest('header'));
}

function getTopNavigationElements() {
  const header = document.querySelector<HTMLElement>('header');
  if (!header) return [];

  return Array.from(header.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.closest('[data-tv-no-focus="true"]'))
    .filter(isVisible);
}

function getContentFocusableElements() {
  const scopedElements = getScopedFocusableElements();
  if (scopedElements) return scopedElements;

  return Array.from(document.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.closest('header'))
    .filter((element) => !element.closest('[data-tv-remote]'))
    .filter((element) => !element.closest('[data-tv-no-focus="true"]'))
    .filter(isVisible);
}

function focusNearestTopNavigationElement(active: HTMLElement) {
  const topNavigationElements = getTopNavigationElements();
  if (topNavigationElements.length === 0) return false;

  const pathname = window.location.pathname;
  const activeNavigationElement = topNavigationElements.find((element) => {
    if (!(element instanceof HTMLAnchorElement)) return false;
    const href = element.getAttribute('href');
    if (!href) return false;
    return href === '/tv'
      ? pathname === '/tv'
      : pathname === href || pathname.startsWith(`${href}/`);
  });

  if (activeNavigationElement) {
    focusElement(activeNavigationElement);
    return true;
  }

  const activeRect = active.getBoundingClientRect();
  const activeCenterX = activeRect.left + activeRect.width / 2;
  const bestNavigationElement =
    topNavigationElements.reduce<HTMLElement | null>((best, element) => {
      if (!best) return element;
      const rect = element.getBoundingClientRect();
      const bestRect = best.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - activeCenterX);
      const bestDistance = Math.abs(
        bestRect.left + bestRect.width / 2 - activeCenterX
      );
      return distance < bestDistance ? element : best;
    }, null);

  if (!bestNavigationElement) return false;
  focusElement(bestNavigationElement);
  return true;
}

function moveTopNavigationFocus(
  active: HTMLElement,
  direction: 'left' | 'right'
) {
  const topNavigationElements = getTopNavigationElements();
  const currentIndex = topNavigationElements.indexOf(active);
  if (currentIndex === -1) return false;

  const nextIndex =
    direction === 'right'
      ? Math.min(currentIndex + 1, topNavigationElements.length - 1)
      : Math.max(currentIndex - 1, 0);

  if (nextIndex === currentIndex) return true;

  focusElement(topNavigationElements[nextIndex]);
  return true;
}

function moveHorizontalRowFocus(
  active: HTMLElement,
  direction: 'left' | 'right'
) {
  const row = active.closest<HTMLElement>('[data-tv-focus-row="horizontal"]');
  if (!row) return false;

  const rowElements = Array.from(
    row.querySelectorAll<HTMLElement>(focusableSelector)
  )
    .filter((element) => !element.closest('[data-tv-no-focus="true"]'))
    .filter(isVisible);
  const currentIndex = rowElements.indexOf(active);
  if (currentIndex === -1) return false;

  const nextIndex =
    direction === 'right'
      ? Math.min(currentIndex + 1, rowElements.length - 1)
      : Math.max(currentIndex - 1, 0);

  if (nextIndex === currentIndex) return true;

  focusElement(rowElements[nextIndex]);
  return true;
}

function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });

  const isInFixedChrome = Boolean(
    element.closest(
      'header, [data-tv-remote], [data-tv-player-control], [data-tv-player-root]'
    )
  );

  // 播放页浮层是 fixed/absolute，不能 scrollIntoView，否则会把全屏播放器滚出视口。
  if (!isInFixedChrome) {
    element.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
    window.requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const safeTop = 150;
      const safeBottom = window.innerHeight - 96;

      if (rect.top < safeTop) {
        window.scrollBy({ top: rect.top - safeTop, behavior: 'smooth' });
      } else if (rect.bottom > safeBottom) {
        window.scrollBy({ top: rect.bottom - safeBottom, behavior: 'smooth' });
      }
    });
  } else {
    scrollIntoScrollableParent(element);
  }
}

function moveSpatialFocus(
  direction: 'up' | 'down' | 'left' | 'right',
  lastFocused?: HTMLElement | null
) {
  const elements = getFocusableElements();
  if (elements.length === 0) return;

  const active =
    document.activeElement instanceof HTMLElement &&
    !document.activeElement.closest('[data-tv-remote]')
      ? document.activeElement
      : lastFocused && document.body.contains(lastFocused)
      ? lastFocused
      : null;

  if (!active || !elements.includes(active)) {
    focusElement(elements[0]);
    return;
  }

  if (
    (direction === 'left' || direction === 'right') &&
    isTopNavigationElement(active)
  ) {
    if (moveTopNavigationFocus(active, direction)) return;
  }

  if (direction === 'left' || direction === 'right') {
    if (moveHorizontalRowFocus(active, direction)) return;
  }

  if (direction === 'down' && isTopNavigationElement(active)) {
    const firstContentElement = getContentFocusableElements()[0];
    if (firstContentElement) {
      focusElement(firstContentElement);
      return;
    }
  }

  if (direction === 'up' && !isTopNavigationElement(active)) {
    const activeRect = active.getBoundingClientRect();
    const activeCenterY = activeRect.top + activeRect.height / 2;
    const hasContentAbove = getContentFocusableElements().some((element) => {
      if (element === active) return false;
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2 < activeCenterY - 8;
    });

    if (!hasContentAbove) {
      if (focusNearestTopNavigationElement(active)) return;
    }
  }

  const current = active.getBoundingClientRect();
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;

  const candidates: Array<{ element: HTMLElement; score: number }> = [];

  for (const element of elements) {
    if (element === active) continue;
    const rect = element.getBoundingClientRect();
    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    const inDirection =
      direction === 'right'
        ? dx > 8 && Math.abs(dx) >= Math.abs(dy) * 0.25
        : direction === 'left'
        ? dx < -8 && Math.abs(dx) >= Math.abs(dy) * 0.25
        : direction === 'down'
        ? dy > 8 && Math.abs(dy) >= Math.abs(dx) * 0.25
        : dy < -8 && Math.abs(dy) >= Math.abs(dx) * 0.25;

    if (!inDirection) continue;

    const primary =
      direction === 'left' || direction === 'right'
        ? Math.abs(dx)
        : Math.abs(dy);
    const secondary =
      direction === 'left' || direction === 'right'
        ? Math.abs(dy)
        : Math.abs(dx);
    const score = primary + secondary * 2.4;

    candidates.push({ element, score });
  }

  let eligibleCandidates = candidates;
  if (direction === 'up' && !isTopNavigationElement(active)) {
    const contentCandidates = candidates.filter(
      ({ element }) => !isTopNavigationElement(element)
    );
    if (contentCandidates.length > 0) {
      eligibleCandidates = contentCandidates;
    }
  }

  const best = eligibleCandidates.reduce<{
    element: HTMLElement;
    score: number;
  } | null>(
    (currentBest, candidate) =>
      !currentBest || candidate.score < currentBest.score
        ? candidate
        : currentBest,
    null
  );

  if (best) focusElement(best.element);
}

function activateFocused() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && !active.closest('[data-tv-remote]')) {
    active.click();
  }
}

function RemoteButton({
  label,
  onClick,
  onRepeat,
  repeatable = false,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  onRepeat?: () => void;
  repeatable?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const delayRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const clearRepeat = () => {
    if (delayRef.current) window.clearTimeout(delayRef.current);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    delayRef.current = null;
    intervalRef.current = null;
  };

  useEffect(() => clearRepeat, []);

  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={() => {
        if (!repeatable) onClick();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        if (!repeatable) return;
        onClick();
        clearRepeat();
        delayRef.current = window.setTimeout(() => {
          intervalRef.current = window.setInterval(onRepeat || onClick, 130);
        }, 360);
      }}
      onPointerUp={clearRepeat}
      onPointerCancel={clearRepeat}
      onPointerLeave={clearRepeat}
      onMouseDown={(event) => event.preventDefault()}
      className={`flex cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white shadow-lg shadow-black/30 outline-none transition hover:bg-white/20 active:scale-95 focus-visible:ring-4 focus-visible:ring-rose-500/70 ${className}`}
    >
      {children}
    </button>
  );
}

export default function TVVirtualRemote() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !target.closest('[data-tv-remote]')
      ) {
        lastFocusedRef.current = target;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }

      if (event.defaultPrevented) return;

      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        // 播放页选集弹窗有自己的方向键导航和焦点陷阱；
        // 这里如果也执行全局空间焦点移动，会导致一次按键移动两格。
        if (document.querySelector('[data-tv-episode-panel]')) {
          return;
        }

        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active.closest('[data-tv-danmaku-settings]')
        ) {
          return;
        }

        if (
          active instanceof HTMLInputElement &&
          active.type === 'range' &&
          active.closest('[data-tv-danmaku-settings]')
        ) {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            return;
          }
        }

        if (
          active instanceof HTMLInputElement &&
          active.type === 'range' &&
          active.closest('[data-tv-no-focus="true"]')
        ) {
          return;
        }

        event.preventDefault();
        const direction = event.key.replace('Arrow', '').toLowerCase() as
          | 'up'
          | 'down'
          | 'left'
          | 'right';
        moveSpatialFocus(direction, lastFocusedRef.current);
        return;
      }

      if (event.key === 'Enter') {
        const playerRoot = document.querySelector<HTMLElement>(
          '[data-tv-player-root]'
        );
        if (playerRoot?.dataset.tvControlsOpen === 'false') {
          return;
        }

        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          !active.closest('input, textarea, select') &&
          !active.closest('[data-tv-remote]')
        ) {
          event.preventDefault();
          activateFocused();
        }
        return;
      }

      if (event.key === 'Escape') {
        const path = window.location.pathname;
        const playerPage = path === '/tv/play' || path === '/tv/live/play';
        // 播放页需要优先用返回键关闭选集/频道面板，不能被全局遥控器直接 history.back。
        if (!playerPage) {
          event.preventDefault();
          window.history.back();
        }
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        router.push('/tv');
      }
    };

    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [router]);

  if (!open) return null;

  return (
    <aside
      data-tv-remote
      className='fixed bottom-6 right-6 z-[80] w-[280px] rounded-[34px] border border-white/10 bg-slate-950/88 p-5 text-white shadow-2xl shadow-black/70 backdrop-blur-2xl'
    >
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <div className='text-xl font-black'>虚拟遥控器</div>
          <div className='text-sm text-slate-400'>F1 打开 / 关闭</div>
        </div>
        <RemoteButton
          label='关闭遥控器'
          onClick={() => setOpen(false)}
          className='h-11 w-11 rounded-full bg-rose-600/90 hover:bg-rose-500'
        >
          <Power className='h-5 w-5' />
        </RemoteButton>
      </div>

      <div className='grid grid-cols-3 gap-3'>
        <RemoteButton
          label='返回'
          onClick={() => fireTVRemoteKey('back')}
          className='h-14'
        >
          <RotateCcw className='h-6 w-6' />
        </RemoteButton>
        <RemoteButton
          label='主页'
          onClick={() => fireTVRemoteKey('home')}
          className='h-14'
        >
          <Home className='h-6 w-6' />
        </RemoteButton>
        <RemoteButton
          label='菜单'
          onClick={() => fireTVRemoteKey('menu')}
          className='h-14'
        >
          <Menu className='h-6 w-6' />
        </RemoteButton>

        <div />
        <RemoteButton
          label='上'
          onClick={() => fireTVRemoteKey('up')}
          onRepeat={() => fireTVRemoteKey('up', true)}
          repeatable
          className='h-16'
        >
          <ChevronUp className='h-9 w-9' />
        </RemoteButton>
        <div />

        <RemoteButton
          label='左'
          onClick={() => fireTVRemoteKey('left')}
          onRepeat={() => fireTVRemoteKey('left', true)}
          repeatable
          className='h-16'
        >
          <ChevronLeft className='h-9 w-9' />
        </RemoteButton>
        <RemoteButton
          label='确认'
          onClick={() => fireTVRemoteKey('ok')}
          className='h-16 rounded-full bg-white text-black hover:bg-slate-200'
        >
          <CornerDownLeft className='h-8 w-8' />
        </RemoteButton>
        <RemoteButton
          label='右'
          onClick={() => fireTVRemoteKey('right')}
          onRepeat={() => fireTVRemoteKey('right', true)}
          repeatable
          className='h-16'
        >
          <ChevronRight className='h-9 w-9' />
        </RemoteButton>

        <div />
        <RemoteButton
          label='下'
          onClick={() => fireTVRemoteKey('down')}
          onRepeat={() => fireTVRemoteKey('down', true)}
          repeatable
          className='h-16'
        >
          <ChevronDown className='h-9 w-9' />
        </RemoteButton>
        <div />
      </div>

      <div className='mt-4 rounded-2xl bg-white/[0.06] p-3 text-center text-sm text-slate-300'>
        点击按钮会向当前页面发送方向键 / Enter / Esc
      </div>
    </aside>
  );
}
