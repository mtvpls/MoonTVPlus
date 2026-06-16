'use client';

import {
  BadgeCheck,
  Clock3,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Volume2,
} from 'lucide-react';
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
        <section className='mx-auto max-w-5xl rounded-[42px] border border-white/10 bg-slate-950/75 p-12 text-center shadow-2xl shadow-black/60'>
          <Loader2 className='mx-auto h-16 w-16 animate-spin text-rose-400' />
          <h1 className='mt-6 text-5xl font-black'>正在读取登录信息</h1>
          <p className='mt-4 text-2xl text-slate-300'>
            请稍候，电视端会自动跳转。
          </p>
        </section>
      </TVLayout>
    );
  }

  return (
    <TVLayout>
      <section className='mx-auto max-w-6xl overflow-hidden rounded-[42px] border border-white/10 bg-slate-950/75 shadow-2xl shadow-black/60 backdrop-blur-xl'>
        <div className='relative p-10 md:p-12'>
          <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(244,63,94,0.25),transparent_34%),radial-gradient(circle_at_85%_0%,rgba(67,56,202,0.28),transparent_30%)]' />
          <div className='relative grid gap-10 lg:grid-cols-[1fr_340px]'>
            <div>
              <div className='inline-flex items-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-5 py-2 text-xl font-bold text-emerald-200'>
                <BadgeCheck className='h-6 w-6' />
                已登录电视端
              </div>
              <div className='mt-8 flex items-center gap-7'>
                <div className='flex h-28 w-28 shrink-0 items-center justify-center rounded-[32px] bg-gradient-to-br from-rose-500 to-indigo-600 text-6xl font-black text-white shadow-2xl shadow-rose-950/50'>
                  {avatarText}
                </div>
                <div>
                  <h1 className='text-6xl font-black tracking-tight text-white md:text-7xl'>
                    {username}
                  </h1>
                  <p className='mt-3 text-2xl text-slate-300'>
                    欢迎回来，继续享受大屏观影。
                  </p>
                </div>
              </div>

              <div className='mt-10 grid gap-4 md:grid-cols-2'>
                <div className='rounded-[28px] border border-white/10 bg-white/[0.06] p-6'>
                  <div className='flex items-center gap-3 text-xl font-bold text-slate-300'>
                    <ShieldCheck className='h-6 w-6 text-rose-300' />
                    账号角色
                  </div>
                  <div className='mt-4 text-4xl font-black text-white'>
                    {roleText}
                  </div>
                </div>
                <div className='rounded-[28px] border border-white/10 bg-white/[0.06] p-6'>
                  <div className='flex items-center gap-3 text-xl font-bold text-slate-300'>
                    <Clock3 className='h-6 w-6 text-indigo-300' />
                    登录时间
                  </div>
                  <div className='mt-4 text-3xl font-black text-white'>
                    {formatDateTime(authInfo.timestamp)}
                  </div>
                </div>
              </div>
            </div>

            <aside className='flex flex-col justify-between rounded-[34px] border border-white/10 bg-black/35 p-7'>
              <div>
                <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10'>
                  <User className='h-9 w-9 text-rose-300' />
                </div>
                <h2 className='mt-6 text-4xl font-black'>我的账号</h2>
                <p className='mt-4 text-xl leading-relaxed text-slate-300'>
                  当前设备已绑定该账号。登出后会清除电视端会话，并返回扫码登录页。
                </p>
              </div>

              <div className='mt-10'>
                {error && (
                  <p
                    role='alert'
                    className='mb-4 rounded-2xl border border-red-400/40 bg-red-950/50 p-4 text-xl text-red-100'
                  >
                    {error}
                  </p>
                )}
                <button
                  type='button'
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className='tv-focusable flex w-full cursor-pointer items-center justify-center gap-3 rounded-3xl bg-rose-600 px-7 py-5 text-3xl font-black text-white outline-none transition duration-200 hover:bg-rose-500 focus:ring-4 focus:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70'
                >
                  {loggingOut ? (
                    <Loader2 className='h-8 w-8 animate-spin' />
                  ) : (
                    <LogOut className='h-8 w-8' />
                  )}
                  {loggingOut ? '正在登出' : '登出'}
                </button>
              </div>
            </aside>
          </div>

          <div className='relative mt-10 rounded-[34px] border border-white/10 bg-black/35 p-7'>
            <div className='flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between'>
              <div className='max-w-2xl'>
                <div className='flex items-center gap-3 text-3xl font-black text-white'>
                  <SlidersHorizontal className='h-9 w-9 text-rose-300' />
                  偏好设置
                </div>
                <p className='mt-3 text-xl leading-relaxed text-slate-300'>
                  这些设置保存在当前电视设备上。
                </p>
              </div>

              <div className='w-full rounded-[28px] border border-white/10 bg-white/[0.06] p-6 lg:max-w-[560px]'>
                <div className='flex items-start justify-between gap-5'>
                  <div>
                    <h3 className='text-2xl font-black text-white'>
                      播放页上下键功能
                    </h3>
                    <p className='mt-2 text-lg leading-relaxed text-slate-300'>
                      播放页遥控器 ↑ / ↓ 键执行的操作。
                    </p>
                  </div>
                  <div className='shrink-0 rounded-2xl bg-slate-950/55 px-4 py-2 text-lg font-black text-rose-100'>
                    {upDownAction === 'wake-menu' ? '唤醒菜单' : '音量控制'}
                  </div>
                </div>

                <div
                  data-tv-preference-up-down-action
                  onKeyDownCapture={handleUpDownActionKeyDown}
                  className='mt-5 grid gap-3 sm:grid-cols-2'
                >
                  <button
                    ref={wakeMenuButtonRef}
                    type='button'
                    onClick={() => handleUpDownActionChange('wake-menu')}
                    className={`tv-focusable flex cursor-pointer items-center justify-center gap-3 rounded-2xl px-5 py-4 text-xl font-black outline-none transition focus:ring-4 focus:ring-rose-300 ${
                      upDownAction === 'wake-menu'
                        ? 'bg-rose-600 text-white shadow-lg shadow-rose-950/40'
                        : 'bg-white/10 text-slate-200 hover:bg-white/15'
                    }`}
                  >
                    <Menu className='h-6 w-6' />
                    唤醒菜单
                  </button>
                  <button
                    ref={volumeButtonRef}
                    type='button'
                    onClick={() => handleUpDownActionChange('volume')}
                    className={`tv-focusable flex cursor-pointer items-center justify-center gap-3 rounded-2xl px-5 py-4 text-xl font-black outline-none transition focus:ring-4 focus:ring-rose-300 ${
                      upDownAction === 'volume'
                        ? 'bg-rose-600 text-white shadow-lg shadow-rose-950/40'
                        : 'bg-white/10 text-slate-200 hover:bg-white/15'
                    }`}
                  >
                    <Volume2 className='h-6 w-6' />
                    音量控制
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </TVLayout>
  );
}
