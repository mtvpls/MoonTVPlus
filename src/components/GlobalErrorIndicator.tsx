'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  timestamp: number;
}

export function GlobalErrorIndicator() {
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const currentErrorRef = useRef<ErrorInfo | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    clearExitTimer();
    setIsClosing(true);
    setIsReplacing(false);

    exitTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      setCurrentError(null);
      setIsClosing(false);
      exitTimerRef.current = null;
    }, 300);
  }, [clearCloseTimer, clearExitTimer]);

  useEffect(() => {
    currentErrorRef.current = currentError;
  }, [currentError]);

  useEffect(() => {
    // 监听自定义错误事件
    const handleError = (event: CustomEvent) => {
      const { message } = event.detail;
      const newError: ErrorInfo = {
        id: Date.now().toString(),
        message,
        timestamp: Date.now(),
      };

      clearCloseTimer();
      clearExitTimer();
      setIsClosing(false);
      setIsVisible(true);

      // 如果已有错误，开始替换动画
      if (currentErrorRef.current) {
        setCurrentError(newError);
        setIsReplacing(true);

        // 动画完成后恢复正常
        setTimeout(() => {
          setIsReplacing(false);
        }, 200);
      } else {
        // 第一次显示错误
        setCurrentError(newError);
      }
    };

    // 监听错误事件
    window.addEventListener('globalError', handleError as EventListener);

    return () => {
      clearCloseTimer();
      clearExitTimer();
      window.removeEventListener('globalError', handleError as EventListener);
    };
  }, [clearCloseTimer, clearExitTimer]);

  useEffect(() => {
    if (!currentError || isClosing) {
      return;
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      handleClose();
    }, 5000);

    return () => {
      clearCloseTimer();
    };
  }, [currentError, handleClose, isClosing, clearCloseTimer]);

  if (!isVisible || !currentError) {
    return null;
  }

  return (
    <div className='fixed top-4 right-4 z-[2000]'>
      {/* 错误卡片 */}
      <div
        className={`bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between min-w-[300px] max-w-[400px] transition-all duration-300 ${
          isClosing
            ? '-translate-y-4 opacity-0'
            : 'translate-y-0 opacity-100'
        } ${
          isReplacing ? 'scale-105 bg-red-400' : 'scale-100 bg-red-500'
        } animate-fade-in`}
      >
        <span className='text-sm font-medium flex-1 mr-3'>
          {currentError.message}
        </span>
        <button
          onClick={handleClose}
          className='text-white hover:text-red-100 transition-colors flex-shrink-0'
          aria-label='关闭错误提示'
        >
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 全局错误触发函数
export function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}
