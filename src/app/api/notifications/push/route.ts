import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';
import {
  createPushSubscriptionRecord,
  getVapidPublicKey,
  isWebPushConfigured,
} from '@/lib/web-push';

export const runtime = 'nodejs';

function extractSubscriptionKeys(subscription: any) {
  const p256dh = subscription?.keys?.p256dh || subscription?.toJSON?.()?.keys?.p256dh;
  const auth = subscription?.keys?.auth || subscription?.toJSON?.()?.keys?.auth;
  return { p256dh, auth };
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storage = getStorage();

  const [configured, publicKey, subscriptions] = await Promise.all([
    isWebPushConfigured(storage),
    getVapidPublicKey(storage),
    storage.getEnabledPushSubscriptions
      ? storage.getEnabledPushSubscriptions(authInfo.username)
      : Promise.resolve([]),
  ]);

  const currentDeviceSubscriptions = authInfo.tokenId
    ? subscriptions.filter((item) => item.tokenId === authInfo.tokenId)
    : [];

  return NextResponse.json({
    configured,
    publicKey,
    pushNotifications: currentDeviceSubscriptions.length > 0,
    hasDeviceToken: Boolean(authInfo.tokenId),
    subscriptionCount: subscriptions.length,
    currentDeviceSubscriptionCount: currentDeviceSubscriptions.length,
  });
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { subscription, enabled } = body;
  const storage = getStorage();

  if (enabled === false) {
    if (authInfo.tokenId) {
      await storage.deletePushSubscriptionsByTokenId?.(authInfo.username, authInfo.tokenId);
    }
    return NextResponse.json({ ok: true });
  }

  if (subscription) {
    const { p256dh, auth } = extractSubscriptionKeys(subscription);
    if (!subscription.endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
    }

    if (!authInfo.tokenId) {
      return NextResponse.json(
        { error: '当前登录模式不支持设备级浏览器通知订阅' },
        { status: 400 }
      );
    }

    await storage.upsertPushSubscription?.(
      authInfo.username,
      createPushSubscriptionRecord({
        username: authInfo.username,
        tokenId: authInfo.tokenId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        userAgent: request.headers.get('user-agent'),
      })
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const storage = getStorage();

  if (body?.endpoint) {
    await storage.deletePushSubscriptionByEndpoint?.(authInfo.username, body.endpoint);
  } else if (authInfo.tokenId) {
    await storage.deletePushSubscriptionsByTokenId?.(authInfo.username, authInfo.tokenId);
  }

  return NextResponse.json({ ok: true });
}
