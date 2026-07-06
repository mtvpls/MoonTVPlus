/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import type { NextRequest } from 'next/server';
import nodeFetch from 'node-fetch';

import type { AdminConfig } from './admin.types';
import { generateAuthCookieValue } from './auth-cookie';
import { getConfig } from './config';
import { db, getStorage } from './db';
import { lockManager } from './lock';
import type { IStorage, Notification } from './types';
import { getNotificationClickUrl } from './web-push';

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  apiProxy: string;
  apiBaseUrl: string;
  loginEnabled: boolean;
  bindingEnabled: boolean;
  registrationEnabled: boolean;
  notificationsEnabled: boolean;
  defaultNotifications: boolean;
}

export class TelegramApiError extends Error {
  status: number;
  statusText: string;
  body: string;
  data: unknown;

  constructor(message: string, response: Response, body: string, data: unknown) {
    super(message);
    this.name = 'TelegramApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
    this.data = data;
  }
}

export interface TelegramBinding {
  username: string;
  telegramUserId: string;
  chatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  notificationsEnabled: boolean;
  boundAt: number;
  updatedAt: number;
}

type TelegramLoginStatus = 'pending' | 'awaiting_confirm' | 'confirmed' | 'denied' | 'expired' | 'used';

interface TelegramLoginSession {
  token: string;
  status: TelegramLoginStatus;
  createdAt: number;
  expiresAt: number;
  username?: string;
  telegramUserId?: string;
  authToken?: string;
}

interface TelegramBindSession {
  code: string;
  username: string;
  createdAt: number;
  expiresAt: number;
  used?: boolean;
}

const LOGIN_TTL_MS = 5 * 60 * 1000;
const BIND_TTL_MS = 10 * 60 * 1000;

function randomToken(bytes = 24): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString('base64url');
}

function randomBindCode(): string {
  const array = new Uint8Array(4);
  crypto.getRandomValues(array);
  const value = new DataView(array.buffer).getUint32(0) % 1_000_000;
  return value.toString().padStart(6, '0');
}

function now() {
  return Date.now();
}

function readEnvTelegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const enabled = process.env.TELEGRAM_BOT_ENABLED === 'true' || Boolean(botToken);

  return {
    enabled,
    botToken,
    botUsername,
    webhookSecret,
    apiProxy: process.env.TELEGRAM_API_PROXY || '',
    apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || '',
    loginEnabled: process.env.TELEGRAM_LOGIN_ENABLED !== 'false',
    bindingEnabled: process.env.TELEGRAM_BINDING_ENABLED !== 'false',
    registrationEnabled: process.env.TELEGRAM_REGISTRATION_ENABLED === 'true',
    notificationsEnabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== 'false',
    defaultNotifications: process.env.TELEGRAM_DEFAULT_NOTIFICATIONS !== 'false',
  };
}

function mergeAdminTelegramConfig(base: TelegramConfig, admin?: AdminConfig | null): TelegramConfig {
  const cfg = admin?.TelegramConfig;
  if (!cfg) return base;

  return {
    enabled: cfg.enabled ?? base.enabled,
    botToken: cfg.botToken || base.botToken,
    botUsername: cfg.botUsername || base.botUsername,
    webhookSecret: cfg.webhookSecret || base.webhookSecret,
    apiProxy: cfg.apiProxy || base.apiProxy,
    apiBaseUrl: cfg.apiBaseUrl || base.apiBaseUrl,
    loginEnabled: cfg.loginEnabled ?? base.loginEnabled,
    bindingEnabled: cfg.bindingEnabled ?? base.bindingEnabled,
    registrationEnabled: cfg.registrationEnabled ?? base.registrationEnabled,
    notificationsEnabled: cfg.notificationsEnabled ?? base.notificationsEnabled,
    defaultNotifications: cfg.defaultNotifications ?? base.defaultNotifications,
  };
}

export async function getTelegramConfig(storage?: IStorage): Promise<TelegramConfig> {
  const base = readEnvTelegramConfig();
  try {
    const resolvedStorage = storage || getStorage();
    const adminConfig = await resolvedStorage.getAdminConfig?.();
    return mergeAdminTelegramConfig(base, adminConfig);
  } catch {
    return base;
  }
}

function loginSessionKey(token: string) {
  return `telegram:login:${token}`;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await db.getGlobalValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    await db.deleteGlobalValue(key);
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  await db.setGlobalValue(key, JSON.stringify(value));
}

export async function getTelegramBinding(username: string): Promise<TelegramBinding | null> {
  return db.getTelegramBinding(username) as Promise<TelegramBinding | null>;
}

export async function getTelegramBindingByTelegramUser(telegramUserId: string): Promise<TelegramBinding | null> {
  return db.getTelegramBindingByTelegramUserId(telegramUserId) as Promise<TelegramBinding | null>;
}

export async function createTelegramBindSession(username: string): Promise<TelegramBindSession> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomBindCode();
    const existing = await db.getTelegramBindSession(code);
    if (existing && existing.expiresAt > now() && !existing.used) continue;

    const session: TelegramBindSession = {
      code,
      username,
      createdAt: now(),
      expiresAt: now() + BIND_TTL_MS,
    };
    await db.upsertTelegramBindSession({ ...session, used: false });
    return session;
  }

  throw new Error('生成 Telegram 绑定码失败');
}

export async function bindTelegramUser(input: {
  code: string;
  telegramUserId: string;
  chatId: string;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
}): Promise<TelegramBinding> {
  const session = await db.getTelegramBindSession(input.code);
  if (!session || session.used || session.expiresAt <= now()) {
    throw new Error('绑定码无效或已过期');
  }

  const config = await getTelegramConfig();
  const existingByTelegram = await getTelegramBindingByTelegramUser(input.telegramUserId);
  if (existingByTelegram && existingByTelegram.username !== session.username) {
    await db.deleteTelegramBindingByUsername(existingByTelegram.username);
  }

  const binding: TelegramBinding = {
    username: session.username,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    telegramUsername: input.telegramUsername,
    firstName: input.firstName,
    lastName: input.lastName,
    notificationsEnabled: config.defaultNotifications,
    boundAt: now(),
    updatedAt: now(),
  };

  await db.upsertTelegramBinding(binding);
  await db.markTelegramBindSessionUsed(input.code);
  return binding;
}

export async function unbindTelegramUser(telegramUserId: string): Promise<boolean> {
  const binding = await getTelegramBindingByTelegramUser(telegramUserId);
  if (!binding) return false;

  await db.deleteTelegramBindingByTelegramUserId(telegramUserId);
  return true;
}

export async function registerTelegramUser(input: {
  username: string;
  password: string;
  telegramUserId: string;
  chatId: string;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
}): Promise<TelegramBinding> {
  const config = await getTelegramConfig();
  if (!config.registrationEnabled) {
    throw new Error('Telegram 注册未开启，请联系管理员在后台开启。');
  }

  const storageType =
    (process.env.NEXT_PUBLIC_STORAGE_TYPE as
      | 'localstorage'
      | 'redis'
      | 'upstash'
      | 'kvrocks'
      | undefined) || 'localstorage';
  if (storageType === 'localstorage') {
    throw new Error('localStorage 模式不支持注册功能');
  }

  const username = input.username.trim();
  const password = input.password;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error('用户名只能包含字母、数字、下划线，长度3-20位');
  }
  if (password.length < 6) {
    throw new Error('密码长度至少为6位');
  }
  if (username === process.env.USERNAME) {
    throw new Error('该用户名不可用');
  }

  const existingBinding = await getTelegramBindingByTelegramUser(input.telegramUserId);
  if (existingBinding) {
    throw new Error(`当前 Telegram 已绑定账号：${existingBinding.username}`);
  }

  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = await lockManager.acquire(`register:${username}`);
  } catch {
    throw new Error('服务器繁忙，请稍后重试');
  }

  try {
    const userExists = await db.checkUserExistV2(username);
    if (userExists) {
      throw new Error('用户名已存在');
    }

    const siteConfig = (await getConfig()).SiteConfig;
    const defaultTags =
      siteConfig.DefaultUserTags && siteConfig.DefaultUserTags.length > 0
        ? siteConfig.DefaultUserTags
        : undefined;

    await db.createUserV2(username, password, 'user', defaultTags);

    const binding: TelegramBinding = {
      username,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      telegramUsername: input.telegramUsername,
      firstName: input.firstName,
      lastName: input.lastName,
      notificationsEnabled: config.defaultNotifications,
      boundAt: now(),
      updatedAt: now(),
    };

    await db.upsertTelegramBinding(binding);
    return binding;
  } finally {
    releaseLock?.();
  }
}

export async function createTelegramLoginSession(): Promise<TelegramLoginSession> {
  const session: TelegramLoginSession = {
    token: randomToken(),
    status: 'pending',
    createdAt: now(),
    expiresAt: now() + LOGIN_TTL_MS,
  };
  await writeJson(loginSessionKey(session.token), session);
  return session;
}

export async function getTelegramLoginSession(token?: string | null): Promise<TelegramLoginSession | null> {
  if (!token) return null;
  const session = await readJson<TelegramLoginSession>(loginSessionKey(token));
  if (!session) return null;

  if (session.expiresAt <= now() && session.status !== 'confirmed' && session.status !== 'used') {
    session.status = 'expired';
    await writeJson(loginSessionKey(token), session);
  }

  return session;
}

async function getUserRole(username: string): Promise<'owner' | 'admin' | 'user'> {
  if (username === process.env.USERNAME) return 'owner';
  const userInfo = await db.getUserInfoV2(username);
  return userInfo?.role || 'user';
}

export async function requestTelegramLoginConfirm(token: string, telegramUserId: string): Promise<TelegramLoginSession> {
  const session = await getTelegramLoginSession(token);
  if (!session || session.expiresAt <= now()) throw new Error('登录请求无效或已过期');

  const binding = await getTelegramBindingByTelegramUser(telegramUserId);
  if (!binding) throw new Error('当前 Telegram 账号尚未绑定站内账号');

  session.status = 'awaiting_confirm';
  session.telegramUserId = telegramUserId;
  session.username = binding.username;
  await writeJson(loginSessionKey(token), session);

  await sendTelegramMessage(binding.chatId, `确认登录 MoonTVPlus 账号：${binding.username}`, {
    inline_keyboard: [[
      { text: '确认登录', callback_data: `tg_login_confirm:${token}` },
      { text: '拒绝', callback_data: `tg_login_deny:${token}` },
    ]],
  });

  return session;
}

export async function confirmTelegramLogin(token: string, telegramUserId: string): Promise<TelegramLoginSession> {
  const session = await getTelegramLoginSession(token);
  if (!session || session.expiresAt <= now()) throw new Error('登录请求无效或已过期');
  if (session.telegramUserId && session.telegramUserId !== telegramUserId) throw new Error('登录请求与 Telegram 账号不匹配');

  const binding = await getTelegramBindingByTelegramUser(telegramUserId);
  if (!binding) throw new Error('当前 Telegram 账号尚未绑定站内账号');

  const role = await getUserRole(binding.username);
  const authToken = await generateAuthCookieValue({
    username: binding.username,
    role,
    includePassword: false,
    deviceInfo: 'Telegram Bot Login',
  });

  session.status = 'confirmed';
  session.username = binding.username;
  session.telegramUserId = telegramUserId;
  session.authToken = authToken;
  await writeJson(loginSessionKey(token), session);
  return session;
}

export async function denyTelegramLogin(token: string, telegramUserId: string): Promise<void> {
  const session = await getTelegramLoginSession(token);
  if (!session) return;
  if (session.telegramUserId && session.telegramUserId !== telegramUserId) return;
  session.status = 'denied';
  await writeJson(loginSessionKey(token), session);
}

export async function consumeConfirmedTelegramLogin(token: string): Promise<TelegramLoginSession | null> {
  const session = await getTelegramLoginSession(token);
  if (!session || session.status !== 'confirmed' || !session.authToken) return session;
  session.status = 'used';
  await writeJson(loginSessionKey(token), session);
  return session;
}

function isCloudflareEnvironment(): boolean {
  return process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
}

function normalizeTelegramApiBaseUrl(input?: string | null): string {
  const base = (input || 'https://api.telegram.org').trim().replace(/\/+$/, '');
  return base || 'https://api.telegram.org';
}

function telegramApiUrl(method: string, token: string, apiBaseUrl?: string) {
  return `${normalizeTelegramApiBaseUrl(apiBaseUrl)}/bot${token}/${method}`;
}

async function fetchTelegramApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
  config?: Partial<TelegramConfig>
): Promise<Response> {
  const requestUrl = telegramApiUrl(method, token, config?.apiBaseUrl);
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  if (isCloudflareEnvironment()) {
    if (config?.apiProxy) {
      console.warn('TELEGRAM_API_PROXY is ignored in Cloudflare runtime; use TELEGRAM_API_BASE_URL instead.');
    }
    return fetch(requestUrl, init) as Promise<Response>;
  }

  const fetchOptions: any = { ...init };
  if (config?.apiProxy) {
    fetchOptions.agent = new HttpsProxyAgent(config.apiProxy, {
      timeout: 30000,
      keepAlive: false,
    });
  }

  return nodeFetch(requestUrl, fetchOptions) as unknown as Response;
}

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  webhookSecret: string,
  config?: Partial<TelegramConfig>
): Promise<unknown> {
  const response = await fetchTelegramApi(
    'setWebhook',
    botToken,
    {
      url: webhookUrl,
      secret_token: webhookSecret,
      drop_pending_updates: false,
    },
    config
  );

  const rawText = await response.text().catch(() => '');
  const trimmed = rawText.trim();
  let data: any = null;
  try {
    data = trimmed && trimmed.startsWith('{') ? JSON.parse(trimmed) : null;
  } catch {
    data = null;
  }

  const successByBody = /^(true|ok)$/i.test(trimmed) || /(^|\b)ok(\b|$)/i.test(trimmed);
  const successByJson = data?.ok === true;
  const explicitJsonFailure = data?.ok === false;
  const successByHttp = response.ok && !explicitJsonFailure;

  if (!successByJson && !successByBody && !successByHttp) {
    const detail = data?.description || trimmed || response.statusText || `HTTP ${response.status}`;
    throw new TelegramApiError(`Webhook 设置失败: ${detail}`, response, rawText, data);
  }

  return data?.result ?? true;
}

export async function setTelegramBotCommands(
  botToken: string,
  config?: Partial<TelegramConfig>
): Promise<void> {
  const commands: { command: string; description: string }[] = [
    { command: 'bind', description: '绑定账号' },
    { command: 'status', description: '查看绑定状态' },
    { command: 'help', description: '显示帮助' },
    { command: 'register', description: '注册并绑定账号' },
  ];

  const response = await fetchTelegramApi(
    'setMyCommands',
    botToken,
    { commands },
    config
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Telegram 命令设置失败: ${response.status} ${errorText}`);
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: any,
  configOverride?: Partial<TelegramConfig>
): Promise<void> {
  const config = { ...(await getTelegramConfig()), ...(configOverride || {}) } as TelegramConfig;
  if (!config.enabled || !config.botToken) return;

  const response = await fetchTelegramApi(
    'sendMessage',
    config.botToken,
    {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
    config
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Telegram 发送失败: ${response.status} ${errorText}`);
  }
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  const config = await getTelegramConfig();
  if (!config.enabled || !config.botToken) return;

  await fetchTelegramApi(
    'answerCallbackQuery',
    config.botToken,
    { callback_query_id: callbackQueryId, text },
    config
  ).catch(() => undefined);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNotificationText(notification: Notification, baseUrl?: string) {
  const title = escapeHtml(notification.title);
  const message = escapeHtml(notification.message);
  const path = getNotificationClickUrl(notification);
  const url = baseUrl ? new URL(path, baseUrl).toString() : '';
  return url ? `<b>${title}</b>\n${message}\n\n<a href="${escapeHtml(url)}">打开查看</a>` : `<b>${title}</b>\n${message}`;
}

export async function dispatchTelegramNotification(
  storage: IStorage,
  username: string,
  notification: Notification
): Promise<void> {
  const config = await getTelegramConfig(storage);
  if (!config.enabled || !config.notificationsEnabled || !config.botToken) return;

  const binding = await getTelegramBinding(username);
  if (!binding || !binding.notificationsEnabled) return;

  try {
    await sendTelegramMessage(binding.chatId, buildNotificationText(notification, process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_BASE));
  } catch (error) {
    console.error('Telegram notification failed:', error);
  }
}

export function getTelegramDeepLink(botUsername: string, payload: string) {
  return `https://t.me/${botUsername.replace(/^@/, '')}?start=${encodeURIComponent(payload)}`;
}

export function getTelegramConfigProblems(
  config: TelegramConfig,
  feature?: 'login' | 'binding' | 'registration' | 'notifications'
): string[] {
  const problems: string[] = [];
  if (!config.enabled) problems.push('总开关未开启');
  if (!config.botToken) problems.push('Bot Token 为空');
  if ((feature === 'login' || feature === 'binding') && !config.botUsername) problems.push('Bot 用户名为空');
  if (feature === 'login' && !config.loginEnabled) problems.push('Telegram 登录开关未开启');
  if (feature === 'binding' && !config.bindingEnabled) problems.push('Telegram 绑定开关未开启');
  if (feature === 'registration' && !config.registrationEnabled) problems.push('Telegram 注册开关未开启');
  if (feature === 'notifications' && !config.notificationsEnabled) problems.push('Telegram 通知开关未开启');
  return problems;
}

function parseMessageText(update: any) {
  const message = update.message;
  if (!message?.text || !message.from || !message.chat) return null;
  return {
    text: String(message.text).trim(),
    telegramUserId: String(message.from.id),
    chatId: String(message.chat.id),
    telegramUsername: message.from.username ? String(message.from.username) : undefined,
    firstName: message.from.first_name ? String(message.from.first_name) : undefined,
    lastName: message.from.last_name ? String(message.from.last_name) : undefined,
  };
}

function buildTelegramHelpText(config: TelegramConfig) {
  const commands: string[] = [
    'MoonTVPlus Telegram Bot 已连接。',
    '',
    '可用命令：',
    config.registrationEnabled ? '/register 用户名 密码 - 注册并绑定账号' : '',
    '/bind 绑定码 - 绑定账号',
    '/status - 查看状态',
    '/help - 显示帮助',
  ];
  return commands.filter(Boolean).join('\n');
}

export async function handleTelegramWebhookUpdate(update: any): Promise<void> {
  const parsed = parseMessageText(update);
  if (parsed) {
    if (/^\/start$/i.test(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, buildTelegramHelpText(await getTelegramConfig()));
      return;
    }

    if (/^\/bind$/i.test(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, '请先在站内「账号/通知设置」里生成 6 位 Telegram 绑定码，然后发送：\n/bind 123456');
      return;
    }

    const startLoginMatch = parsed.text.match(/^\/start\s+login_(.+)$/i);
    if (startLoginMatch) {
      try {
        await requestTelegramLoginConfirm(startLoginMatch[1], parsed.telegramUserId);
      } catch (error) {
        await sendTelegramMessage(parsed.chatId, error instanceof Error ? error.message : 'Telegram 登录失败');
      }
      return;
    }

    const bindMatch = parsed.text.match(/^\/(?:bind|start)\s+(?:bind_)?(\d{6})$/i);
    if (bindMatch) {
      try {
        const binding = await bindTelegramUser({ ...parsed, code: bindMatch[1] });
        await sendTelegramMessage(parsed.chatId, `绑定成功：${binding.username}\n后续可使用 Telegram 登录和接收通知。`);
      } catch (error) {
        await sendTelegramMessage(parsed.chatId, error instanceof Error ? error.message : '绑定失败');
      }
      return;
    }

    if (/^\/register$/i.test(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, '请发送：\n/register 用户名 密码\n\n用户名只能包含字母、数字、下划线，长度3-20位；密码至少6位。');
      return;
    }

    const registerMatch = parsed.text.match(/^\/register\s+(\S+)\s+(\S+)$/i);
    if (registerMatch) {
      try {
        const binding = await registerTelegramUser({
          ...parsed,
          username: registerMatch[1],
          password: registerMatch[2],
        });
        await sendTelegramMessage(parsed.chatId, `注册成功：${binding.username}\n当前 Telegram 已自动绑定该账号。`);
      } catch (error) {
        await sendTelegramMessage(parsed.chatId, error instanceof Error ? error.message : '注册失败');
      }
      return;
    }

    if (/^\/status$/i.test(parsed.text)) {
      const binding = await getTelegramBindingByTelegramUser(parsed.telegramUserId);
      await sendTelegramMessage(parsed.chatId, binding ? `已绑定账号：${binding.username}\n通知：${binding.notificationsEnabled ? '开启' : '关闭'}` : '当前 Telegram 账号尚未绑定。');
      return;
    }

    if (/^\/help$/i.test(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, buildTelegramHelpText(await getTelegramConfig()));
      return;
    }

    await sendTelegramMessage(parsed.chatId, buildTelegramHelpText(await getTelegramConfig()));
    return;
  }

  const callback = update.callback_query;
  if (callback?.data && callback.from?.id && callback.id) {
    const telegramUserId = String(callback.from.id);
    const data = String(callback.data);
    const confirmMatch = data.match(/^tg_login_confirm:(.+)$/);
    const denyMatch = data.match(/^tg_login_deny:(.+)$/);
    
    if (confirmMatch) {
      try {
        await confirmTelegramLogin(confirmMatch[1], telegramUserId);
        await answerCallbackQuery(callback.id, '已确认登录');
      } catch (error) {
        await answerCallbackQuery(callback.id, error instanceof Error ? error.message : '确认失败');
      }
      return;
    }

    if (denyMatch) {
      await denyTelegramLogin(denyMatch[1], telegramUserId);
      await answerCallbackQuery(callback.id, '已拒绝登录');
    }
  }
}

export async function validateTelegramWebhookRequest(request: NextRequest, secretParam: string) {
  const config = await getTelegramConfig();
  const configuredSecret = config.webhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  return Boolean(
    secretParam &&
    configuredSecret &&
    secretParam === configuredSecret &&
    (!headerSecret || headerSecret === configuredSecret)
  );
}
