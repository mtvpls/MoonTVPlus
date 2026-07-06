import type { IStorage, Notification } from './types';
import { dispatchTelegramNotification } from './telegram';
import { dispatchWebPushNotification } from './web-push';

export async function dispatchNotificationChannels(
  storage: IStorage,
  userName: string,
  notification: Notification
): Promise<void> {
  await Promise.allSettled([
    dispatchWebPushNotification(storage, userName, notification),
    dispatchTelegramNotification(storage, userName, notification),
  ]);
}
