import { NextResponse } from 'next/server';

import { getTelegramConfig, getTelegramConfigProblems } from '@/lib/telegram';

export const runtime = 'nodejs';

export async function GET() {
  const config = await getTelegramConfig();
  const loginProblems = getTelegramConfigProblems(config, 'login');
  const bindingProblems = getTelegramConfigProblems(config, 'binding');
  const registrationProblems = getTelegramConfigProblems(config, 'registration');
  return NextResponse.json({
    enabled: config.enabled && Boolean(config.botToken),
    botUsername: config.botUsername.replace(/^@/, ''),
    loginEnabled: loginProblems.length === 0,
    bindingEnabled: bindingProblems.length === 0,
    registrationEnabled: registrationProblems.length === 0,
    notificationsEnabled: config.notificationsEnabled,
    problems: Array.from(new Set([...loginProblems, ...bindingProblems, ...registrationProblems])),
  });
}
