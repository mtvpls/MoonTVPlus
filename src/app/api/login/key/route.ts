import { NextRequest, NextResponse } from 'next/server';

import {
  generateAuthCookieValue,
  getDeviceInfoFromUserAgent,
} from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';
import { KeyLoginError, resolveKeyLogin } from '@/lib/key-login';
import {
  ensureKeyBrowserUser,
  KEY_BROWSER_COOKIE,
  KEY_BROWSER_COOKIE_MAX_AGE,
} from '@/lib/key-login-browser';
import { getKeyLoginRequestOrigin } from '@/lib/key-login-origin';
import {
  checkLoginBan,
  getLoginClientIp,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/login-fail2ban';
import { TOKEN_CONFIG } from '@/lib/token-config';

export const runtime = 'nodejs';

function json(
  body: Record<string, unknown>,
  status = 200,
  retryAfter?: number
) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}

export async function POST(request: NextRequest) {
  // Also rate-limit clients whose reverse proxy does not provide an IP.
  const clientIp = getLoginClientIp(request) || 'key-login:unknown';
  const ban = checkLoginBan(clientIp);
  if (ban.banned) {
    return json(
      { error: '登录失败次数过多，请稍后再试' },
      429,
      ban.retryAfterSeconds
    );
  }

  const browserOrigin = getKeyLoginRequestOrigin(request);
  if (!browserOrigin) {
    return json({ error: '不允许跨站登录请求' }, 403);
  }
  // Reject form/text submissions instead of silently parsing them as JSON.
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return json({ error: '请求必须使用 application/json' }, 415);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ error: '请求格式错误' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  try {
    const identity = resolveKeyLogin(body.accessKey);
    const { SiteConfig: siteConfig } = await getConfig();

    // A new login entry must not silently bypass the existing CAPTCHA policy.
    if (siteConfig.LoginRequireTurnstile) {
      if (typeof body.turnstileToken !== 'string' || !body.turnstileToken) {
        return json({ error: '请完成人机验证' }, 400);
      }
      if (!siteConfig.TurnstileSecretKey) {
        return json({ error: '人机验证配置不完整，请联系站长' }, 503);
      }
      const verification = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: siteConfig.TurnstileSecretKey,
            response: body.turnstileToken,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      const result = await verification.json();
      if (!verification.ok || result.success !== true) {
        recordLoginFailure(clientIp);
        return json({ error: '人机验证失败，请重试' }, 400);
      }
    }

    let username: string;
    let role: 'user' | 'owner';
    let browserUser: Awaited<ReturnType<typeof ensureKeyBrowserUser>> | null =
      null;
    if (identity.kind === 'user') {
      browserUser = await ensureKeyBrowserUser(
        request.cookies.get(KEY_BROWSER_COOKIE)?.value,
        siteConfig.DefaultUserTags
      );
      username = browserUser.username;
      role = 'user';
    } else {
      // The verified PASSWORD logs into the env-defined owner exactly as the
      // original password endpoint does. Never create a new management account.
      username = identity.username;
      role = 'owner';
    }
    const cookieValue = await generateAuthCookieValue({
      username,
      role,
      includePassword: false,
      deviceInfo: `${getDeviceInfoFromUserAgent(
        request.headers.get('user-agent') || ''
      )} (密钥登录)`,
    });

    const response = json({ ok: true });
    response.cookies.set('auth', cookieValue, {
      path: '/',
      expires: new Date(Date.now() + TOKEN_CONFIG.REFRESH_TOKEN_AGE),
      sameSite: 'lax',
      // Existing navigation and token refresh read this signed cookie.
      // Neither the access key nor the account password is included in it.
      httpOnly: false,
      secure: browserOrigin.protocol === 'https:',
    });
    if (browserUser) {
      // This is only a data-namespace identifier. It cannot authenticate without
      // a valid access key. Keep it on logout so this browser can resume later.
      response.cookies.set(KEY_BROWSER_COOKIE, browserUser.cookieValue, {
        path: '/api/login/key',
        maxAge: KEY_BROWSER_COOKIE_MAX_AGE,
        sameSite: 'lax',
        httpOnly: true,
        secure: browserOrigin.protocol === 'https:',
      });
    }
    recordLoginSuccess(clientIp);
    return response;
  } catch (error) {
    if (error instanceof KeyLoginError) {
      if (error.status === 401) recordLoginFailure(clientIp);
      return json({ error: error.message }, error.status);
    }
    // Do not log credentials, submitted request bodies or auth tokens.
    return json({ error: '密钥登录暂时不可用，请稍后重试或使用密码登录' }, 500);
  }
}
