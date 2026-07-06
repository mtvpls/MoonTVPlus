import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { getTelegramConfig, sendTelegramMessage, setTelegramBotCommands, setTelegramWebhook, TelegramApiError } from '@/lib/telegram';

export const runtime = 'nodejs';


async function assertAdmin(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) return { error: 'Unauthorized', status: 401 } as const;

  const storage = getStorage();
  const userInfo = await storage.getUserInfoV2?.(authInfo.username);
  if (!userInfo || (userInfo.role !== 'admin' && userInfo.role !== 'owner')) {
    return { error: 'Forbidden', status: 403 } as const;
  }

  return { storage } as const;
}

function maskTelegramConfig(config: AdminConfig['TelegramConfig']) {
  return {
    enabled: config?.enabled || false,
    botToken: config?.botToken ? '******' : '',
    botUsername: config?.botUsername || '',
    webhookSecret: config?.webhookSecret ? '******' : '',
    apiProxy: config?.apiProxy || '',
    apiBaseUrl: config?.apiBaseUrl || '',
    loginEnabled: config?.loginEnabled !== false,
    bindingEnabled: config?.bindingEnabled !== false,
    registrationEnabled: config?.registrationEnabled === true,
    notificationsEnabled: config?.notificationsEnabled !== false,
    defaultNotifications: config?.defaultNotifications !== false,
  };
}

export async function GET(request: NextRequest) {
  const auth = await assertAdmin(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const adminConfig = await getConfig();
  return NextResponse.json(maskTelegramConfig(adminConfig.TelegramConfig));
}

export async function POST(request: NextRequest) {
  const auth = await assertAdmin(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const { action, config, testChatId, webhookUrl, origin } = body;

  if (action === 'set_webhook') {
    const overrideConfig = config as AdminConfig['TelegramConfig'] | undefined;
    const savedConfig = await getTelegramConfig();
    const botToken =
      overrideConfig?.botToken && overrideConfig.botToken !== '******'
        ? overrideConfig.botToken
        : savedConfig.botToken;
    const secret =
      overrideConfig?.webhookSecret && overrideConfig.webhookSecret !== '******'
        ? overrideConfig.webhookSecret
        : savedConfig.webhookSecret;
    const baseOrigin = String(origin || '').trim().replace(/\/$/, '');
    const resolvedWebhookUrl = String(webhookUrl || '').trim() ||
      (baseOrigin && secret ? `${baseOrigin}/api/telegram/webhook/${secret}` : '');

    if (!botToken || !secret || !resolvedWebhookUrl) {
      return NextResponse.json({ error: '缺少 Bot Token、Webhook Secret 或站点地址' }, { status: 400 });
    }

    const apiProxy = overrideConfig?.apiProxy || savedConfig.apiProxy;
    const apiBaseUrl = overrideConfig?.apiBaseUrl || savedConfig.apiBaseUrl;

    try {
      const result = await setTelegramWebhook(botToken, resolvedWebhookUrl, secret, {
        apiProxy,
        apiBaseUrl,
      });
      await setTelegramBotCommands(botToken, { apiProxy, apiBaseUrl });
      return NextResponse.json({ success: true, message: 'Webhook 设置成功', result });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        return NextResponse.json(
          {
            error: error.message,
            telegram: {
              status: error.status,
              statusText: error.statusText,
              body: error.body,
              data: error.data,
              apiBaseUrl: apiBaseUrl || 'https://api.telegram.org',
              apiProxyEnabled: Boolean(apiProxy),
            },
          },
          { status: 502 }
        );
      }

      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Webhook 设置失败' },
        { status: 502 }
      );
    }
  }

  if (action === 'test') {
    if (!testChatId) {
      return NextResponse.json({ error: '请填写测试 Chat ID' }, { status: 400 });
    }

    const overrideConfig = config as AdminConfig['TelegramConfig'] | undefined;
    const savedConfig = await getTelegramConfig();
    const botToken =
      overrideConfig?.botToken && overrideConfig.botToken !== '******'
        ? overrideConfig.botToken
        : savedConfig.botToken;

    await sendTelegramMessage(
      String(testChatId),
      'MoonTVPlus Telegram Bot 测试消息发送成功。',
      undefined,
      {
        enabled: true,
        botToken,
        botUsername: overrideConfig?.botUsername || savedConfig.botUsername,
        apiProxy: overrideConfig?.apiProxy || savedConfig.apiProxy,
        apiBaseUrl: overrideConfig?.apiBaseUrl || savedConfig.apiBaseUrl,
      }
    );
    return NextResponse.json({ success: true, message: '测试消息发送成功' });
  }

  if (action !== 'save') {
    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  }

  const telegramConfig = config as AdminConfig['TelegramConfig'];
  if (!telegramConfig) {
    return NextResponse.json({ error: 'Telegram 配置不能为空' }, { status: 400 });
  }

  if (telegramConfig.enabled && (!telegramConfig.botToken || !telegramConfig.botUsername)) {
    return NextResponse.json({ error: '启用 Telegram 时必须填写 Bot Token 和 Bot 用户名' }, { status: 400 });
  }

  const adminConfig = await getConfig();
  const oldConfig = adminConfig.TelegramConfig;
  if (telegramConfig.botToken === '******') telegramConfig.botToken = oldConfig?.botToken || '';
  if (telegramConfig.webhookSecret === '******') telegramConfig.webhookSecret = oldConfig?.webhookSecret || '';

  adminConfig.TelegramConfig = telegramConfig;
  await auth.storage.setAdminConfig(adminConfig);
  return NextResponse.json({ success: true, message: 'Telegram 配置保存成功' });
}
