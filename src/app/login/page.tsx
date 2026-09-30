/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Eye, EyeOff, KeyRound, Lock, Send, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { getSafeLoginRedirect } from '@/lib/login-redirect';
import { CURRENT_VERSION } from '@/lib/version';

import HomeSkeleton from '@/components/login/HomeSkeleton';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

type LoginMethod = 'key' | 'password';

// 根据按钮文本识别OIDC提供商并返回对应的图标
function getOIDCProviderIcon(buttonText: string) {
  const text = buttonText.toLowerCase();

  const providers = [
    { keywords: ['linuxdo'], icon: '/icons/linuxdo.png', alt: 'LinuxDo' },
    { keywords: ['github'], icon: '/icons/github.png', alt: 'GitHub' },
    { keywords: ['google'], icon: '/icons/google.png', alt: 'Google' },
    { keywords: ['microsoft', 'azure', 'entra'], icon: '/icons/microsoft.png', alt: 'Microsoft' },
    { keywords: ['gitlab'], icon: '/icons/gitlab.png', alt: 'GitLab' },
  ];

  for (const provider of providers) {
    if (provider.keywords.some(keyword => text.includes(keyword))) {
      return <img src={provider.icon} alt={provider.alt} className='w-5 h-5 mr-2' />;
    }
  }

  // 默认图标
  return (
    <svg className='w-5 h-5 mr-2' fill='currentColor' viewBox='0 0 20 20'>
      <path fillRule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clipRule='evenodd' />
    </svg>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [accessKey, setAccessKey] = useState('');
  const [showAccessKey, setShowAccessKey] = useState(false);
  const [keyLoginEnabled, setKeyLoginEnabled] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [siteConfig, setSiteConfig] = useState<any>(null);
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(
    null
  );
  const [telegramLoginEnabled, setTelegramLoginEnabled] = useState(false);
  const [telegramLoginLoading, setTelegramLoginLoading] = useState(false);
  const [telegramLoginHint, setTelegramLoginHint] = useState<string | null>(
    null
  );

  const { siteName } = useSite();

  // 处理URL中的error参数
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(errorParam);
    }
  }, [searchParams]);

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG;
      const storageType = runtimeConfig?.STORAGE_TYPE;
      const shouldAsk = storageType && storageType !== 'localstorage';
      setShouldAskUsername(shouldAsk);

      // 设置站点配置
      setSiteConfig({
        LoginRequireTurnstile: runtimeConfig?.LOGIN_REQUIRE_TURNSTILE || false,
        TurnstileSiteKey: runtimeConfig?.TURNSTILE_SITE_KEY || '',
        EnableRegistration: runtimeConfig?.ENABLE_REGISTRATION || false,
        EnableOIDCLogin: runtimeConfig?.ENABLE_OIDC_LOGIN || false,
        OIDCButtonText: runtimeConfig?.OIDC_BUTTON_TEXT || '',
      });
      setTelegramLoginEnabled(Boolean(runtimeConfig?.ENABLE_TELEGRAM_LOGIN));
      const enableKeyLogin = Boolean(runtimeConfig?.KEY_LOGIN_ENABLED);
      setKeyLoginEnabled(enableKeyLogin);
      setLoginMethod(enableKeyLogin ? 'key' : 'password');
      setConfigReady(true);

      // 从localStorage读取记住的密码信息
      const rememberedCredentials = localStorage.getItem(
        'rememberedCredentials'
      );
      if (rememberedCredentials) {
        try {
          const credentials = JSON.parse(rememberedCredentials);
          if (credentials.password) {
            setPassword(credentials.password);
          }
          if (credentials.username && shouldAsk) {
            setUsername(credentials.username);
          }
          setRememberPassword(true);
        } catch (error) {
          // 清除无效的数据
          localStorage.removeItem('rememberedCredentials');
        }
      }
    }
  }, []);

  // 加载Cloudflare Turnstile脚本
  useEffect(() => {
    if (!siteConfig?.LoginRequireTurnstile || !siteConfig?.TurnstileSiteKey) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setTurnstileLoaded(true);
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [siteConfig]);

  // 渲染Turnstile组件
  useEffect(() => {
    if (!turnstileLoaded || !siteConfig?.TurnstileSiteKey) {
      return;
    }

    const container = document.getElementById('turnstile-container');
    if (container && (window as any).turnstile) {
      const widgetId = (window as any).turnstile.render(
        '#turnstile-container',
        {
          sitekey: siteConfig.TurnstileSiteKey,
          callback: (token: string) => {
            setTurnstileToken(token);
          },
          'expired-callback': () => setTurnstileToken(null),
          'error-callback': () => setTurnstileToken(null),
        }
      );
      setTurnstileWidgetId(widgetId);
      return () => {
        (window as any).turnstile?.remove(widgetId);
      };
    }
  }, [turnstileLoaded, siteConfig]);

  const switchLoginMethod = (method: LoginMethod) => {
    if (loading || telegramLoginLoading) return;
    setLoginMethod(method);
    setError(null);
    setTelegramLoginHint(null);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const method: LoginMethod =
      event.key === 'Home'
        ? 'key'
        : event.key === 'End'
        ? 'password'
        : loginMethod === 'key'
        ? 'password'
        : 'key';
    switchLoginMethod(method);
    document.getElementById(`login-tab-${method}`)?.focus();
  };

  const handleKeySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || !keyLoginEnabled || !accessKey.trim()) return;
    setError(null);
    if (siteConfig?.LoginRequireTurnstile && !turnstileToken) {
      setError('请完成人机验证');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/login/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessKey,
          ...(siteConfig?.LoginRequireTurnstile ? { turnstileToken } : {}),
        }),
      });
      if (response.ok) {
        // Never save the access key to localStorage or to a client cookie.
        setAccessKey('');
        window.location.replace(
          getSafeLoginRedirect(searchParams.get('redirect'))
        );
        return;
      }
      const data = await response.json().catch(() => ({}));
      setError(data.error || '密钥验证失败，请重试');
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      if (turnstileWidgetId !== null && (window as any).turnstile) {
        (window as any).turnstile.reset(turnstileWidgetId);
        setTurnstileToken(null);
      }
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    // 检查Turnstile验证
    if (siteConfig?.LoginRequireTurnstile && !turnstileToken) {
      setError('请完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
          ...(siteConfig?.LoginRequireTurnstile ? { turnstileToken } : {}),
        }),
      });

      if (res.ok) {
        // 处理记住密码逻辑
        if (rememberPassword) {
          const credentials: any = { password };
          // 如果需要用户名且有用户名，就保存用户名
          if (shouldAskUsername && username) {
            credentials.username = username;
          }
          localStorage.setItem(
            'rememberedCredentials',
            JSON.stringify(credentials)
          );
        } else {
          // 如果不记住密码，清除已存储的信息
          localStorage.removeItem('rememberedCredentials');
        }

        const redirect = getSafeLoginRedirect(searchParams.get('redirect'));
        window.location.replace(redirect);
      } else {
        // 登录失败，重置Turnstile
        if (
          siteConfig?.LoginRequireTurnstile &&
          turnstileWidgetId !== null &&
          (window as any).turnstile
        ) {
          (window as any).turnstile.reset(turnstileWidgetId);
          setTurnstileToken(null);
        }

        if (res.status === 401) {
          setError('密码错误');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? '服务器错误');
        }
      }
    } catch (error) {
      // 网络错误，重置Turnstile
      if (
        siteConfig?.LoginRequireTurnstile &&
        turnstileWidgetId !== null &&
        (window as any).turnstile
      ) {
        (window as any).turnstile.reset(turnstileWidgetId);
        setTurnstileToken(null);
      }
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleTelegramLogin = async () => {
    setError(null);
    setTelegramLoginHint(null);

    try {
      setTelegramLoginLoading(true);
      const createRes = await fetch('/api/telegram/login/create', {
        method: 'POST',
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const configDetail = createData.config
          ? `（enabled=${String(
              createData.config.enabled
            )}, loginEnabled=${String(
              createData.config.loginEnabled
            )}, hasBotToken=${String(
              createData.config.hasBotToken
            )}, hasBotUsername=${String(
              createData.config.hasBotUsername
            )}, botUsername=${createData.config.botUsername || '-'}）`
          : `（HTTP ${createRes.status}）`;
        setError(
          `${createData.error || 'Telegram 登录接口不可用'}${configDetail}`
        );
        return;
      }

      setTelegramLoginHint('请在 Telegram 中确认登录');
      window.open(createData.deepLink, '_blank', 'noopener,noreferrer');

      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        if (Date.now() - startedAt > 5 * 60 * 1000) {
          window.clearInterval(timer);
          setTelegramLoginLoading(false);
          setTelegramLoginHint(null);
          setError('Telegram 登录已超时，请重试');
          return;
        }

        const statusRes = await fetch(
          `/api/telegram/login/status?token=${encodeURIComponent(
            createData.token
          )}`
        );
        const statusData = await statusRes.json().catch(() => ({}));
        if (statusData.status === 'confirmed') {
          window.clearInterval(timer);
          const redirect = getSafeLoginRedirect(searchParams.get('redirect'));
          window.location.replace(redirect);
        } else if (statusData.status === 'denied') {
          window.clearInterval(timer);
          setTelegramLoginLoading(false);
          setTelegramLoginHint(null);
          setError('已拒绝 Telegram 登录');
        } else if (statusData.status === 'expired') {
          window.clearInterval(timer);
          setTelegramLoginLoading(false);
          setTelegramLoginHint(null);
          setError('Telegram 登录已过期');
        }
      }, 2000);
    } catch (error) {
      setError('Telegram 登录请求失败，请稍后重试');
      setTelegramLoginLoading(false);
      setTelegramLoginHint(null);
    }
  };

  const isKeyLogin = keyLoginEnabled && loginMethod === 'key';
  const submitDisabled =
    !configReady ||
    loading ||
    telegramLoginLoading ||
    (isKeyLogin
      ? !keyLoginEnabled || !accessKey.trim()
      : !password || (shouldAskUsername && !username)) ||
    (siteConfig?.LoginRequireTurnstile && !turnstileToken);
  const inputClassName =
    'block w-full rounded-lg border border-gray-300 bg-white py-3 pl-10 pr-12 text-base text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <main className='relative isolate flex min-h-screen items-center justify-center px-4 py-10'>
      <HomeSkeleton />
      <div
        aria-hidden='true'
        className='pointer-events-none fixed inset-0 bg-gray-950/25 dark:bg-black/55'
      />
      <section
        aria-labelledby='login-title'
        aria-busy={!configReady}
        className='relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900 sm:p-8'
      >
        <div className='mb-6 flex items-start justify-between gap-4'>
          <div>
            <h1
              id='login-title'
              className='text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100'
            >
              {siteName}
            </h1>
            <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
              登录后，开启你的观影空间
            </p>
          </div>
          <ThemeToggle />
        </div>

        {configReady && keyLoginEnabled && (
          <div
            role='tablist'
            aria-label='登录方式'
            className='mb-6 flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800'
          >
            {(['key', 'password'] as const).map((method) => (
              <button
                key={method}
                type='button'
                role='tab'
                id={`login-tab-${method}`}
                aria-selected={loginMethod === method}
                aria-controls={`login-panel-${method}`}
                tabIndex={loginMethod === method ? 0 : -1}
                disabled={loading || telegramLoginLoading}
                onClick={() => switchLoginMethod(method)}
                onKeyDown={handleTabKeyDown}
                className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:cursor-wait ${
                  loginMethod === method
                    ? 'bg-white text-green-700 shadow-sm dark:bg-gray-700 dark:text-green-300'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {method === 'key' ? (
                  <KeyRound aria-hidden='true' className='h-4 w-4' />
                ) : (
                  <Lock aria-hidden='true' className='h-4 w-4' />
                )}
                {method === 'key' ? '密钥登录' : '密码登录'}
              </button>
            ))}
          </div>
        )}

        {!configReady && (
          <p role='status' className='text-sm text-gray-500'>
            正在加载登录选项…
          </p>
        )}

        <form
          onSubmit={isKeyLogin ? handleKeySubmit : handleSubmit}
          hidden={!configReady}
          className='space-y-5'
        >
          {keyLoginEnabled && (
            <div
              role='tabpanel'
              id='login-panel-key'
              aria-labelledby='login-tab-key'
              hidden={!isKeyLogin}
            >
              <label
                htmlFor='access-key'
                className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
              >
                访问密钥
              </label>
              <div className='relative'>
                <KeyRound
                  aria-hidden='true'
                  className='pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-gray-400'
                />
                <input
                  id='access-key'
                  name='accessKey'
                  type={showAccessKey ? 'text' : 'password'}
                  autoComplete='off'
                  autoCapitalize='none'
                  spellCheck={false}
                  maxLength={1024}
                  aria-describedby='access-key-help'
                  className={inputClassName}
                  placeholder='输入普通密钥或管理员密钥'
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  disabled={!isKeyLogin || loading}
                  required={isKeyLogin}
                />
                <button
                  type='button'
                  aria-label={showAccessKey ? '隐藏密钥' : '显示密钥'}
                  onClick={() => setShowAccessKey(!showAccessKey)}
                  className='absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500'
                >
                  {showAccessKey ? (
                    <EyeOff className='h-5 w-5' />
                  ) : (
                    <Eye className='h-5 w-5' />
                  )}
                </button>
              </div>
              <p
                id='access-key-help'
                className='mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400'
              >
                密钥由站长提供，验证成功后才会加载首页、导航和业务数据。
              </p>
              <p className='mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400'>
                普通密钥的收藏与记录按浏览器隔离；请保留本站
                Cookie，以便下次找回。
              </p>
            </div>
          )}

          <div
            role={keyLoginEnabled ? 'tabpanel' : undefined}
            id='login-panel-password'
            aria-labelledby={keyLoginEnabled ? 'login-tab-password' : undefined}
            hidden={isKeyLogin}
            className='space-y-5'
          >
            {shouldAskUsername && (
              <div>
                <label
                  htmlFor='username'
                  className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
                >
                  用户名
                </label>
                <div className='relative'>
                  <User
                    aria-hidden='true'
                    className='pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-gray-400'
                  />
                  <input
                    id='username'
                    name='username'
                    type='text'
                    autoComplete='username'
                    className={inputClassName}
                    placeholder='输入用户名'
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={isKeyLogin || loading}
                    required={!isKeyLogin}
                  />
                </div>
              </div>
            )}
            <div>
              <label
                htmlFor='password'
                className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
              >
                密码
              </label>
              <div className='relative'>
                <Lock
                  aria-hidden='true'
                  className='pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-gray-400'
                />
                <input
                  id='password'
                  name='password'
                  type={showPassword ? 'text' : 'password'}
                  autoComplete='current-password'
                  className={inputClassName}
                  placeholder='输入访问密码'
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isKeyLogin || loading}
                  required={!isKeyLogin}
                />
                <button
                  type='button'
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword(!showPassword)}
                  className='absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500'
                >
                  {showPassword ? (
                    <EyeOff className='h-5 w-5' />
                  ) : (
                    <Eye className='h-5 w-5' />
                  )}
                </button>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <input
                id='remember-password'
                type='checkbox'
                checked={rememberPassword}
                onChange={(event) => setRememberPassword(event.target.checked)}
                className='h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-700'
              />
              <label
                htmlFor='remember-password'
                className='text-sm text-gray-700 dark:text-gray-300'
              >
                记住密码
              </label>
            </div>
          </div>

          {/* Shared widget: switching tabs never bypasses or destroys CAPTCHA. */}
          {siteConfig?.LoginRequireTurnstile &&
            siteConfig?.TurnstileSiteKey && (
              <div id='turnstile-container' className='flex justify-center' />
            )}
          {error && (
            <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
          )}
          <button
            type='submit'
            disabled={submitDisabled}
            className='inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-green-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading ? '登录中…' : isKeyLogin ? '验证密钥并进入' : '登录'}
          </button>
          {!isKeyLogin &&
            siteConfig?.EnableRegistration &&
            shouldAskUsername && (
              <div className='text-center'>
                <button
                  type='button'
                  onClick={() => router.push('/register')}
                  className='text-sm text-green-700 hover:underline dark:text-green-400'
                >
                  还没有账号？立即注册
                </button>
              </div>
            )}
        </form>

        {!isKeyLogin &&
          shouldAskUsername &&
          (telegramLoginEnabled || siteConfig?.EnableOIDCLogin) && (
            <div className='mt-6 space-y-3 border-t border-gray-200 pt-5 dark:border-gray-700'>
              <p className='text-center text-xs text-gray-500 dark:text-gray-400'>
                其他账号登录方式
              </p>
              {telegramLoginEnabled && (
                <button
                  type='button'
                  disabled={telegramLoginLoading || loading}
                  onClick={handleTelegramLogin}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-800'
                >
                  <Send aria-hidden='true' className='mr-2 h-4 w-4' />
                  {telegramLoginLoading
                    ? '等待 Telegram 确认…'
                    : '使用 Telegram 登录'}
                </button>
              )}
              {telegramLoginHint && (
                <p
                  role='status'
                  className='text-center text-xs text-gray-500 dark:text-gray-400'
                >
                  {telegramLoginHint}
                </p>
              )}
              {siteConfig?.EnableOIDCLogin && (
                <button
                  type='button'
                  disabled={loading || telegramLoginLoading}
                  onClick={() => {
                    window.location.href = '/api/auth/oidc/login';
                  }}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-800'
                >
                  {getOIDCProviderIcon(siteConfig?.OIDCButtonText || '')}
                  {siteConfig?.OIDCButtonText || '使用OIDC登录'}
                </button>
              )}
            </div>
          )}
        <p className='mt-6 text-center text-xs text-gray-400 dark:text-gray-500'>
          v{CURRENT_VERSION}
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <LoginPageClient />
    </Suspense>
  );
}
