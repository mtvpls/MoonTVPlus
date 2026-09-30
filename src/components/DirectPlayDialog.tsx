'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { buildDirectPlayTarget } from '@/lib/direct-play';

interface DirectPlayDialogProps {
  onClose: () => void;
}

function canUseNetdiskTempPlay(): boolean {
  return Boolean(
    (
      window as Window & {
        RUNTIME_CONFIG?: { NETDISK_TEMP_PLAY_ENABLED?: boolean };
      }
    ).RUNTIME_CONFIG?.NETDISK_TEMP_PLAY_ENABLED
  );
}

/** Shared by desktop/mobile navigation; mounted only when explicitly opened. */
export default function DirectPlayDialog({ onClose }: DirectPlayDialogProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [netdiskEnabled] = useState(canUseNetdiskTempPlay);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !url.trim()) return;
    setError('');
    setSubmitting(true);
    try {
      // Recheck the current permission rather than trusting the displayed hint.
      const target = buildDirectPlayTarget(url, canUseNetdiskTempPlay());
      window.location.assign(target);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '播放失败');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className='fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4'
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key !== 'Tab') return;
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        id='direct-play-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='direct-play-title'
        aria-describedby='direct-play-help'
        className='w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900'
      >
        <div className='flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700'>
          <h2
            id='direct-play-title'
            className='text-lg font-semibold text-gray-900 dark:text-gray-100'
          >
            直链播放
          </h2>
          <button
            type='button'
            onClick={onClose}
            className='flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500 dark:text-gray-400 dark:hover:bg-gray-800'
            aria-label='关闭直链播放'
          >
            <span aria-hidden='true'>×</span>
          </button>
        </div>
        <form onSubmit={submit} className='space-y-4 p-4'>
          <p
            id='direct-play-help'
            className='text-sm text-gray-600 dark:text-gray-300'
          >
            请输入可直接播放的视频链接。
          </p>
          {netdiskEnabled && (
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              支持夸克、UC、百度、天翼、移动、123、115 网盘在线播放。
            </p>
          )}
          <label htmlFor='direct-play-url' className='sr-only'>
            视频链接
          </label>
          <input
            ref={inputRef}
            id='direct-play-url'
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
            placeholder='https://example.com/video.m3u8'
            autoComplete='off'
            autoCapitalize='none'
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'direct-play-error' : 'direct-play-help'}
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
          />
          {error && (
            <p
              id='direct-play-error'
              role='alert'
              className='text-sm text-red-600 dark:text-red-400'
            >
              {error}
            </p>
          )}
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={onClose}
              className='min-h-10 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              取消
            </button>
            <button
              type='submit'
              disabled={!url.trim() || submitting}
              className='min-h-10 rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {submitting ? '处理中...' : '开始播放'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
