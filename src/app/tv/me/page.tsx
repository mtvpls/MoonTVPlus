'use client';

import { Loader2, LogOut, Menu, Volume2, Wifi } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { clearAuthCookie, getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  type TVPlayerUpDownAction,
  DEFAULT_TV_PLAYER_UP_DOWN_ACTION,
  loadTVPlayerUpDownAction,
  saveTVPlayerUpDownAction,
} from '@/lib/tv-preferences';

import TVLayout from '@/components/tv/TVLayout';

const LOCAL_REMOTE_URL_KEY = 'moontv_local_remote_url';

type MoonTVLocalRemoteBridge = {
  getRemoteUrl?: () => string;
};

declare global {
  interface Window {
    MoonTVLocalRemote?: MoonTVLocalRemoteBridge;
    __MOONTV_LOCAL_REMOTE_URL?: string;
  }
}

type AuthInfo = {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  timestamp?: number;
  refreshExpires?: number;
};

function getRoleText(role?: AuthInfo['role']) {
  switch (role) {
    case 'owner':
      return '站长';
    case 'admin':
      return '管理员';
    case 'user':
      return '用户';
    default:
      return '访客';
  }
}

function formatDateTime(value?: number) {
  if (!value) return '当前会话';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '当前会话';
  }
}

export default function TVMePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [localRemoteUrl, setLocalRemoteUrl] = useState('');
  const [upDownAction, setUpDownAction] = useState<TVPlayerUpDownAction>(
    DEFAULT_TV_PLAYER_UP_DOWN_ACTION
  );
  const wakeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const volumeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const auth = getAuthInfoFromBrowserCookie();
    setAuthInfo(auth);
    setUpDownAction(loadTVPlayerUpDownAction());
    setReady(true);
  }, []);

  useEffect(() => {
    const readLocalRemoteUrl = () => {
      const bridgeUrl = window.MoonTVLocalRemote?.getRemoteUrl?.() || '';
      setLocalRemoteUrl(
        bridgeUrl ||
          window.__MOONTV_LOCAL_REMOTE_URL ||
          localStorage.getItem(LOCAL_REMOTE_URL_KEY) ||
          ''
      );
    };

    const onLocalRemoteInfo = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      setLocalRemoteUrl(detail?.url || '');
    };

    readLocalRemoteUrl();
    window.addEventListener('moontv:local-remote-info', onLocalRemoteInfo);
    const timer = window.setInterval(readLocalRemoteUrl, 1500);

    return () => {
      window.removeEventListener('moontv:local-remote-info', onLocalRemoteInfo);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (ready && !authInfo) {
      router.replace('/tv/login?redirect=/tv/me');
    }
  }, [authInfo, ready, router]);

  const username = authInfo?.username || 'default';
  const roleText = getRoleText(authInfo?.role || 'user');
  const avatarText = useMemo(
    () => username.trim().charAt(0).toUpperCase() || 'D',
    [username]
  );

  const handleLogout = async () => {
    setLoggingOut(true);
    setError('');
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      setError('登出请求失败，已清理本地登录状态。');
    } finally {
      clearAuthCookie();
      router.replace('/tv/login');
    }
  };

  const handleUpDownActionChange = (action: TVPlayerUpDownAction) => {
    setUpDownAction(action);
    saveTVPlayerUpDownAction(action);
  };

  const handleUpDownActionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();

    const nextAction: TVPlayerUpDownAction =
      event.key === 'ArrowRight' ? 'volume' : 'wake-menu';
    handleUpDownActionChange(nextAction);
    window.requestAnimationFrame(() => {
      const target =
        nextAction === 'wake-menu'
          ? wakeMenuButtonRef.current
          : volumeButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  if (!ready || !authInfo) {
    return (
      <TVLayout>
        <section
          role='status'
          className='flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 text-xl text-[#a1a1a6]'
        >
          <Loader2
            className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
            strokeWidth={1.5}
            aria-hidden='true'
          />
          正在读取登录信息
        </section>
      </TVLayout>
    );
  }

  return (
    <TVLayout>
      <section className='rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h1 className='text-4xl font-medium leading-tight lg:text-5xl'>
            我的账号
          </h1>
          <span className='text-lg text-[#a1a1a6]'>已登录</span>
        </div>
        <div className='mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
          <div className='min-w-0'>
            <div className='flex items-center gap-4'>
              <div
                aria-hidden='true'
                className='flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#232325] text-4xl font-medium'
              >
                {avatarText}
              </div>
              <h2 className='min-w-0 break-all text-3xl font-medium leading-tight lg:text-4xl'>
                {username}
              </h2>
            </div>
            <dl className='mt-6 flex flex-wrap gap-x-12 gap-y-4'>
              <div>
                <dt className='text-lg text-[#a1a1a6]'>账号角色</dt>
                <dd className='mt-1 text-xl'>{roleText}</dd>
              </div>
              <div>
                <dt className='text-lg text-[#a1a1a6]'>登录时间</dt>
                <dd className='mt-1 text-xl tabular-nums'>
                  {formatDateTime(authInfo.timestamp)}
                </dd>
              </div>
            </dl>
          </div>
          <aside className='flex flex-col justify-end gap-4 border-t border-white/[0.08] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0'>
            <p className='text-lg leading-7 text-[#a1a1a6]'>
              登出后会清除当前电视的登录状态，并返回扫码登录页
            </p>
            {error && (
              <p role='alert' className='text-lg text-rose-200'>
                {error}
              </p>
            )}
            <button
              type='button'
              onClick={handleLogout}
              disabled={loggingOut}
              className='tv-focusable flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#232325] px-5 py-3 text-xl font-medium outline-none hover:bg-[#303033] disabled:cursor-not-allowed disabled:opacity-60'
            >
              {loggingOut ? (
                <Loader2
                  className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
              ) : (
                <LogOut
                  className='h-[18px] w-[18px]'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
              )}
              {loggingOut ? '正在登出' : '登出'}
            </button>
          </aside>
        </div>
      </section>

      <section className='mt-6 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
        <div className='flex flex-col gap-6 md:flex-row md:items-center md:justify-between'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-2xl font-medium lg:text-3xl'>手机扫码遥控</h2>
            <p className='mt-3 text-lg leading-7 text-[#a1a1a6] lg:text-xl'>
              手机与电视连接同一 Wi-Fi，扫码或打开遥控地址
            </p>
            {localRemoteUrl ? (
              <div className='mt-6'>
                <p className='flex items-center gap-2 text-lg text-[#a1a1a6]'>
                  <Wifi
                    className='h-[18px] w-[18px]'
                    strokeWidth={1.5}
                    aria-hidden='true'
                  />
                  局域网遥控地址
                </p>
                <p className='mt-2 break-all font-mono text-lg leading-7'>
                  {localRemoteUrl}
                </p>
              </div>
            ) : (
              <p
                role='status'
                className='mt-6 text-lg leading-7 text-[#a1a1a6]'
              >
                当前设备未提供局域网遥控地址
              </p>
            )}
          </div>
          {localRemoteUrl && (
            <div
              tabIndex={0}
              role='img'
              aria-label='局域网遥控地址二维码，手机扫码打开遥控器'
              className='tv-focusable tv-focusable-light w-full max-w-64 shrink-0 self-start rounded-2xl bg-white p-4 text-[#141415] outline-none md:self-center'
            >
              <img
                src={`/api/auth/qr/image?data=${encodeURIComponent(
                  localRemoteUrl
                )}`}
                alt='局域网遥控地址二维码'
                className='pointer-events-none aspect-square w-full'
                draggable={false}
              />
              <p className='mt-3 text-center text-base'>手机扫码打开遥控器</p>
            </div>
          )}
        </div>
      </section>

      <section className='mt-6 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 lg:p-8'>
        <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
          <div>
            <h2 className='text-2xl font-medium lg:text-3xl'>偏好设置</h2>
            <p className='mt-3 text-lg leading-7 text-[#a1a1a6]'>
              保存在当前电视设备上
            </p>
          </div>
          <div className='min-w-0'>
            <h3 className='text-xl font-medium'>播放页上下键功能</h3>
            <p className='mt-2 text-lg text-[#a1a1a6]'>
              选择遥控器上下键执行的操作
            </p>
            <div
              data-tv-preference-up-down-action
              data-tv-focus-row='horizontal'
              aria-label='播放页上下键功能'
              onKeyDownCapture={handleUpDownActionKeyDown}
              className='mt-5 grid gap-4 sm:grid-cols-2'
            >
              <button
                ref={wakeMenuButtonRef}
                type='button'
                aria-pressed={upDownAction === 'wake-menu'}
                onClick={() => handleUpDownActionChange('wake-menu')}
                className={`tv-focusable flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-3 text-xl outline-none ${
                  upDownAction === 'wake-menu'
                    ? 'border-white/10 bg-[#232325] font-medium text-[#ededed]'
                    : 'border-transparent text-[#a1a1a6] hover:bg-[#232325]'
                }`}
              >
                <Menu
                  className='h-[18px] w-[18px]'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
                唤醒菜单
              </button>
              <button
                ref={volumeButtonRef}
                type='button'
                aria-pressed={upDownAction === 'volume'}
                onClick={() => handleUpDownActionChange('volume')}
                className={`tv-focusable flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-3 text-xl outline-none ${
                  upDownAction === 'volume'
                    ? 'border-white/10 bg-[#232325] font-medium text-[#ededed]'
                    : 'border-transparent text-[#a1a1a6] hover:bg-[#232325]'
                }`}
              >
                <Volume2
                  className='h-[18px] w-[18px]'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
                音量控制
              </button>
            </div>
          </div>
        </div>
      </section>
    </TVLayout>
  );
}
