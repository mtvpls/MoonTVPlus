import { NextResponse } from 'next/server';

import {
  createTelegramLoginSession,
  getTelegramConfig,
  getTelegramConfigProblems,
  getTelegramDeepLink,
} from '@/lib/telegram';

export const runtime = 'nodejs';

export async function POST() {
  const config = await getTelegramConfig();
  const problems = getTelegramConfigProblems(config, 'login');
  if (problems.length > 0) {
    return NextResponse.json({
      error: `Telegram 登录不可用：${problems.join('、')}`,
      config: {
        enabled: config.enabled,
        loginEnabled: config.loginEnabled,
        hasBotToken: Boolean(config.botToken),
        hasBotUsername: Boolean(config.botUsername),
        botUsername: config.botUsername || '',
      },
    }, { status: 400 });
  }

  const session = await createTelegramLoginSession();
  const botUsername = config.botUsername.replace(/^@/, '');
  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
    botUsername,
    deepLink: getTelegramDeepLink(botUsername, `login_${session.token}`),
  });
}
