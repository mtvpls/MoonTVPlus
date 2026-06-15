/* eslint-disable no-console */

import crypto from 'crypto';

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

import { lockManager } from './lock';
import { IStorage, Notification, PushSubscriptionRecord } from './types';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const WEB_PUSH_MAX_RETRIES = 2;
const SUBJECT_ENV = 'WEB_PUSH_SUBJECT';
const PROXY_ENV = 'WEB_PUSH_PROXY';
const BASE_URL_ENV = 'WEB_PUSH_BASEURL';
const VAPID_KEYS_GLOBAL_CONFIG_KEY = 'web_push_vapid_keys';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface WebPushDeliveryResult {
  endpointHost: string;
  ok: boolean;
  status?: number;
  error?: string;
  removed?: boolean;
}

export interface WebPushDispatchResult {
  configured: boolean;
  preferenceEnabled: boolean;
  subscriptionCount: number;
  deliveries: WebPushDeliveryResult[];
}

const globalVapidCacheKey = Symbol.for('__MOONTV_WEB_PUSH_VAPID_KEYS__');
const globalVapidPromiseKey = Symbol.for('__MOONTV_WEB_PUSH_VAPID_KEYS_PROMISE__');

function getCachedVapidKeys(): VapidKeys | null {
  return ((globalThis as any)[globalVapidCacheKey] as VapidKeys | undefined) || null;
}

function setCachedVapidKeys(keys: VapidKeys): void {
  (globalThis as any)[globalVapidCacheKey] = keys;
}

function getCachedVapidKeysPromise(): Promise<VapidKeys> | null {
  return ((globalThis as any)[globalVapidPromiseKey] as Promise<VapidKeys> | undefined) || null;
}

function setCachedVapidKeysPromise(promise: Promise<VapidKeys> | null): void {
  if (promise) {
    (globalThis as any)[globalVapidPromiseKey] = promise;
  } else {
    delete (globalThis as any)[globalVapidPromiseKey];
  }
}

function base64UrlEncode(input: Buffer | Uint8Array | string): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

function isCloudflareEnvironment(): boolean {
  return process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
}

function getWebPushProxy(): string | null {
  const proxy = process.env[PROXY_ENV]?.trim();
  return proxy || null;
}

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function getWebPushRequestUrl(endpoint: string): string {
  const baseUrl = process.env[BASE_URL_ENV]?.trim();
  if (!baseUrl) return endpoint;

  const endpointUrl = new URL(endpoint);
  const normalizedBase = normalizeBaseUrl(baseUrl);

  // 支持自定义转发服务格式：
  // - {endpoint}: URL 编码后的完整原始 endpoint，适合放在 query 参数里
  // - {raw_endpoint}: 未编码的完整原始 endpoint，适合路径重写或代理服务自行解析
  if (normalizedBase.includes('{raw_endpoint}')) {
    return normalizedBase.replace('{raw_endpoint}', endpoint);
  }
  if (normalizedBase.includes('{endpoint}')) {
    return normalizedBase.replace('{endpoint}', encodeURIComponent(endpoint));
  }

  const base = new URL(normalizedBase);
  const basePath = base.pathname.replace(/\/+$/, '');
  const endpointPath = endpointUrl.pathname.startsWith('/')
    ? endpointUrl.pathname
    : `/${endpointUrl.pathname}`;

  base.pathname = `${basePath}${endpointPath}`.replace(/\/+/g, '/');
  base.search = endpointUrl.search;
  return base.toString();
}

async function fetchWebPushEndpoint(
  endpoint: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Buffer;
  }
): Promise<Response> {
  const requestUrl = getWebPushRequestUrl(endpoint);
  const proxy = getWebPushProxy();

  if (isCloudflareEnvironment()) {
    if (proxy) {
      console.warn('WEB_PUSH_PROXY is ignored in Cloudflare runtime; use WEB_PUSH_BASEURL instead.');
    }
    return fetch(requestUrl, init) as Promise<Response>;
  }

  const fetchOptions: any = {
    method: init.method,
    headers: init.headers,
    body: init.body,
  };

  if (proxy) {
    fetchOptions.agent = new HttpsProxyAgent(proxy, {
      timeout: 30000,
      keepAlive: false,
    });
  }

  return nodeFetch(requestUrl, fetchOptions) as unknown as Response;
}

function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();

  return {
    publicKey: base64UrlEncode(ecdh.getPublicKey(undefined, 'uncompressed')),
    privateKey: base64UrlEncode(ecdh.getPrivateKey()),
  };
}

function parseStoredVapidKeys(raw: string | null): VapidKeys | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<VapidKeys>;
    if (parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch (error) {
    console.error('Failed to parse stored Web Push VAPID keys:', error);
  }

  return null;
}

async function loadOrCreateDatabaseVapidKeys(storage: IStorage): Promise<VapidKeys> {
  if (!storage?.getGlobalValue || !storage?.setGlobalValue) {
    throw new Error('当前存储类型不支持保存 Web Push VAPID 密钥');
  }

  const existing = parseStoredVapidKeys(
    await storage.getGlobalValue(VAPID_KEYS_GLOBAL_CONFIG_KEY)
  );
  if (existing) return existing;

  const release = await lockManager.acquire('web-push-vapid-keys');
  try {
    const latest = parseStoredVapidKeys(
      await storage.getGlobalValue(VAPID_KEYS_GLOBAL_CONFIG_KEY)
    );
    if (latest) return latest;

    const keys = generateVapidKeys();
    await storage.setGlobalValue(
      VAPID_KEYS_GLOBAL_CONFIG_KEY,
      JSON.stringify(keys)
    );
    return keys;
  } finally {
    release();
  }
}

export async function getVapidKeys(storage: IStorage): Promise<VapidKeys> {
  const cached = getCachedVapidKeys();
  if (cached) return cached;

  const cachedPromise = getCachedVapidKeysPromise();
  if (cachedPromise) return cachedPromise;

  const promise = loadOrCreateDatabaseVapidKeys(storage)
    .then((keys) => {
      setCachedVapidKeys(keys);
      return keys;
    })
    .finally(() => setCachedVapidKeysPromise(null));

  setCachedVapidKeysPromise(promise);
  return promise;
}

export async function getVapidPublicKey(storage: IStorage): Promise<string | null> {
  try {
    return (await getVapidKeys(storage)).publicKey;
  } catch (error) {
    console.error('Failed to get Web Push VAPID public key:', error);
    return null;
  }
}

export async function isWebPushConfigured(storage: IStorage): Promise<boolean> {
  try {
    await getVapidKeys(storage);
    return true;
  } catch (error) {
    console.error('Web Push VAPID keys are not configured:', error);
    return false;
  }
}

function getVapidSubject(): string {
  return process.env[SUBJECT_ENV] || process.env.NEXT_PUBLIC_SITE_URL || 'mailto:admin@example.com';
}

function getPublicKeyFromPrivate(privateKeyBase64Url: string): Buffer {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(base64UrlDecode(privateKeyBase64Url));
  return ecdh.getPublicKey(undefined, 'uncompressed');
}

function createVapidJwt(endpoint: string, privateKeyBase64Url: string): string {
  const audience = new URL(endpoint).origin;
  const publicKey = getPublicKeyFromPrivate(privateKeyBase64Url);
  const x = publicKey.subarray(1, 33);
  const y = publicKey.subarray(33, 65);
  const d = base64UrlDecode(privateKeyBase64Url);

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: getVapidSubject(),
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(x),
      y: base64UrlEncode(y),
      d: base64UrlEncode(d),
    },
    format: 'jwk',
  });

  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function hkdf(secret: Buffer, salt: Buffer, info: Buffer | string, length: number): Buffer {
  const prk = crypto.createHmac('sha256', salt).update(secret).digest();
  const infoBuffer = Buffer.isBuffer(info) ? info : Buffer.from(info);
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(blocks).length < length) {
    previous = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([previous, infoBuffer, Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
    counter += 1;
  }

  return Buffer.concat(blocks).subarray(0, length);
}

function encryptPayload(payload: string, subscription: PushSubscriptionRecord) {
  const receiverPublicKey = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  const salt = crypto.randomBytes(16);
  const localEcdh = crypto.createECDH('prime256v1');
  localEcdh.generateKeys();
  const senderPublicKey = localEcdh.getPublicKey(undefined, 'uncompressed');
  const sharedSecret = localEcdh.computeSecret(receiverPublicKey);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    receiverPublicKey,
    senderPublicKey,
  ]);
  const ikm = hkdf(sharedSecret, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12);

  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, tag]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);

  const body = Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublicKey.length]),
    senderPublicKey,
    ciphertext,
  ]);

  return body;
}

export function getNotificationClickUrl(notification: Notification): string {
  const metadata = notification.metadata || {};

  if (notification.type === 'favorite_update' && metadata.source && metadata.id) {
    const title = encodeURIComponent(String(metadata.title || ''));
    return `/play?source=${encodeURIComponent(String(metadata.source))}&id=${encodeURIComponent(String(metadata.id))}&title=${title}`;
  }

  if (notification.type === 'manga_update' && metadata.sourceId && metadata.mangaId) {
    const params = new URLSearchParams({
      sourceId: String(metadata.sourceId),
      mangaId: String(metadata.mangaId),
      title: String(metadata.title || ''),
      cover: String(metadata.cover || ''),
      sourceName: String(metadata.sourceName || ''),
    });
    return `/manga/detail?${params.toString()}`;
  }

  if (notification.type === 'movie_request') {
    return '/admin';
  }

  if (notification.type === 'request_fulfilled') {
    if (metadata.source && metadata.id) {
      return `/play?source=${encodeURIComponent(String(metadata.source))}&id=${encodeURIComponent(String(metadata.id))}&title=${encodeURIComponent(notification.title)}`;
    }
    return '/movie-request';
  }

  if (notification.type === 'anime_subscription_update') {
    return '/private-library';
  }

  return '/';
}

function buildPayload(notification: Notification): string {
  return JSON.stringify({
    notificationId: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    body: notification.message,
    url: getNotificationClickUrl(notification),
    timestamp: notification.timestamp,
  });
}

async function sendToSubscription(storage: IStorage, subscription: PushSubscriptionRecord, payload: string): Promise<Response> {
  const keys = await getVapidKeys(storage);

  const jwt = createVapidJwt(subscription.endpoint, keys.privateKey);
  const encryptedBody = encryptPayload(payload, subscription);

  return fetchWebPushEndpoint(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(DEFAULT_TTL_SECONDS),
      Urgency: 'normal',
    },
    body: encryptedBody,
  });
}

function shouldRetryWebPushResponse(response: Response): boolean {
  if (response.status === 404 || response.status === 410) return false;
  return !response.ok;
}

async function sendToSubscriptionWithRetry(
  storage: IStorage,
  subscription: PushSubscriptionRecord,
  payload: string
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= WEB_PUSH_MAX_RETRIES; attempt++) {
    try {
      const response = await sendToSubscription(storage, subscription, payload);
      if (!shouldRetryWebPushResponse(response) || attempt === WEB_PUSH_MAX_RETRIES) {
        return response;
      }

      console.warn(
        `Web Push send failed with ${response.status}, retrying (${attempt + 1}/${WEB_PUSH_MAX_RETRIES})...`
      );
    } catch (error) {
      lastError = error;
      if (attempt === WEB_PUSH_MAX_RETRIES) break;
      console.warn(
        `Web Push send error, retrying (${attempt + 1}/${WEB_PUSH_MAX_RETRIES}):`,
        error
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Web Push send failed'));
}

export async function dispatchWebPushNotificationWithResult(
  storage: IStorage,
  userName: string,
  notification: Notification
): Promise<WebPushDispatchResult> {
  const configured = await isWebPushConfigured(storage);
  if (!configured || !storage.getEnabledPushSubscriptions) {
    return {
      configured,
      preferenceEnabled: false,
      subscriptionCount: 0,
      deliveries: [],
    };
  }

  const subscriptions = await storage.getEnabledPushSubscriptions(userName);
  if (!subscriptions.length) {
    return {
      configured,
      preferenceEnabled: true,
      subscriptionCount: 0,
      deliveries: [],
    };
  }

  const payload = buildPayload(notification);
  const settled = await Promise.allSettled(
    subscriptions.map(async (subscription): Promise<WebPushDeliveryResult> => {
      const endpointHost = new URL(subscription.endpoint).host;
      try {
        const response = await sendToSubscriptionWithRetry(storage, subscription, payload);

        if (response.ok) {
          await storage.updatePushSubscriptionDeliveryStats?.(userName, subscription.endpoint, true);
          return { endpointHost, ok: true, status: response.status };
        }

        if (response.status === 404 || response.status === 410) {
          await storage.deletePushSubscriptionByEndpoint?.(userName, subscription.endpoint);
          return { endpointHost, ok: false, status: response.status, removed: true };
        }

        await storage.updatePushSubscriptionDeliveryStats?.(userName, subscription.endpoint, false);
        const errorText = await response.text().catch(() => '');
        console.warn(`Web Push failed (${response.status}) for ${userName}: ${errorText}`);
        return { endpointHost, ok: false, status: response.status, error: errorText || response.statusText };
      } catch (error) {
        await storage.updatePushSubscriptionDeliveryStats?.(userName, subscription.endpoint, false);
        console.error('Web Push delivery error:', error);
        return {
          endpointHost,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  return {
    configured,
    preferenceEnabled: true,
    subscriptionCount: subscriptions.length,
    deliveries: settled.map((item) =>
      item.status === 'fulfilled'
        ? item.value
        : { endpointHost: 'unknown', ok: false, error: item.reason instanceof Error ? item.reason.message : String(item.reason) }
    ),
  };
}

export async function dispatchWebPushNotification(
  storage: IStorage,
  userName: string,
  notification: Notification
): Promise<void> {
  await dispatchWebPushNotificationWithResult(storage, userName, notification);
}

export function createPushSubscriptionRecord(input: {
  username: string;
  tokenId?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): PushSubscriptionRecord {
  const now = Date.now();
  return {
    id: base64UrlEncode(crypto.createHash('sha256').update(input.endpoint).digest()),
    username: input.username,
    tokenId: input.tokenId || null,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent || null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
  };
}
