'use client';

import { Info, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { isTVRemoteMenuKey } from '@/lib/tv-remote-core';

import { TVItem } from './types';

export default function TVRecordMenu({
  item,
  openingEvent,
  onClose,
  onDelete,
}: {
  item: TVItem;
  openingEvent?: KeyboardEvent;
  onClose: (restoreFocus?: boolean) => void;
  onDelete: () => Promise<void>;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const deletingRef = useRef(false);
  const handledEventsRef = useRef(new WeakSet<KeyboardEvent>());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (openingEvent) handledEventsRef.current.add(openingEvent);

  useEffect(() => {
    mountedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });
    return () => {
      mountedRef.current = false;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const isMenuKey = isTVRemoteMenuKey(event);
      const isBackKey =
        ['Escape', 'Back', 'GoBack', 'BrowserBack', 'Backspace'].includes(
          event.key
        ) ||
        event.keyCode === 461 ||
        event.keyCode === 10009;
      const isDirectionKey = [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(event.key);
      const isConfirmKey = event.key === 'Enter' || event.key === ' ';
      if (
        !isMenuKey &&
        !isBackKey &&
        !isDirectionKey &&
        !isConfirmKey &&
        event.key !== 'Tab' &&
        event.key !== 'Home'
      )
        return;

      event.preventDefault();
      event.stopImmediatePropagation();
      // 虚拟遥控器会把同一事件投递到多个目标，一个按键只处理一次。
      if (handledEventsRef.current.has(event)) return;
      handledEventsRef.current.add(event);

      if (isBackKey || isMenuKey || event.key === 'Home') {
        if (!event.repeat) onClose();
        return;
      }

      const buttons = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]'
        ) || []
      );
      if (!buttons.length) return;
      const index = buttons.findIndex(
        (button) => button === document.activeElement
      );

      if (isConfirmKey) {
        if (!event.repeat) buttons[Math.max(index, 0)]?.click();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const next =
          index < 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  buttons.length - 1,
                  index + (event.key === 'ArrowDown' ? 1 : -1)
                )
              );
        buttons[next].focus({ preventScroll: true });
      } else if (event.key === 'Tab') {
        const next =
          (Math.max(index, 0) + (event.shiftKey ? -1 : 1) + buttons.length) %
          buttons.length;
        buttons[next].focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const removeRecord = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    try {
      await onDelete();
      if (mountedRef.current) onClose();
    } catch {
      if (mountedRef.current) setError('删除记录失败，请稍后重试');
    } finally {
      deletingRef.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  };

  return createPortal(
    <div
      data-tv-record-menu
      role='dialog'
      aria-modal='true'
      aria-labelledby='tv-record-menu-title'
      className='fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-8 text-white backdrop-blur-sm'
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={panelRef}
        className='w-[560px] max-w-full rounded-[32px] border border-white/10 bg-slate-950 p-8 shadow-2xl shadow-black/80'
      >
        <p className='mb-2 text-lg text-slate-400'>观看记录</p>
        <h2 id='tv-record-menu-title' className='text-3xl font-black'>
          {item.title}
        </h2>
        <div role='menu' aria-label='观看记录操作' className='mt-7 space-y-4'>
          <button
            type='button'
            role='menuitem'
            aria-disabled={deleting}
            onClick={() => {
              if (deletingRef.current) return;
              onClose(false);
              router.push(
                item.detailHref ||
                  `/tv/detail?title=${encodeURIComponent(item.title)}`
              );
            }}
            className='tv-focusable flex min-h-20 w-full cursor-pointer items-center gap-4 rounded-2xl bg-white/10 px-6 py-5 text-2xl font-bold outline-none aria-disabled:opacity-50'
          >
            <Info className='h-7 w-7' aria-hidden='true' />
            {item.origin === 'live' ? '进入频道' : '进入详情页'}
          </button>
          <button
            type='button'
            role='menuitem'
            aria-disabled={deleting}
            onClick={() => void removeRecord()}
            className='tv-focusable flex min-h-20 w-full cursor-pointer items-center gap-4 rounded-2xl bg-rose-500/15 px-6 py-5 text-2xl font-bold text-rose-200 outline-none aria-disabled:opacity-50'
          >
            {deleting ? (
              <Loader2 className='h-7 w-7 animate-spin' aria-hidden='true' />
            ) : (
              <Trash2 className='h-7 w-7' aria-hidden='true' />
            )}
            {deleting ? '正在删除...' : '删除记录'}
          </button>
        </div>
        {error && (
          <p role='alert' className='mt-5 text-lg text-rose-300'>
            {error}
          </p>
        )}
        <p className='mt-6 text-center text-lg text-slate-400'>返回键关闭</p>
      </div>
    </div>,
    document.body
  );
}
