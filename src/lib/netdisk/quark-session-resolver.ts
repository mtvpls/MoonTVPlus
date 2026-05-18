import { getConfig } from '@/lib/config';

import { listQuarkShareVideos } from './quark.client';
import {
  createQuarkNetdiskSession,
  getQuarkNetdiskSession,
  parseQuarkNetdiskId,
  refreshQuarkNetdiskSession,
} from './quark-session-cache';

export async function resolveQuarkSession(id: string) {
  const config = await getConfig();
  const quarkConfig = config.NetDiskConfig?.Quark;
  if (!quarkConfig?.Enabled || !quarkConfig.Cookie) {
    throw new Error('夸克网盘未配置或未启用');
  }

  let session = refreshQuarkNetdiskSession(id) || getQuarkNetdiskSession(id);
  if (!session) {
    const payload = parseQuarkNetdiskId(id);
    const result = await listQuarkShareVideos(payload.shareUrl, quarkConfig.Cookie, payload.passcode || '');
    session = createQuarkNetdiskSession({
      title: result.title,
      shareUrl: payload.shareUrl,
      passcode: payload.passcode,
      shareId: result.shareId,
      shareToken: result.shareToken,
      files: result.files,
    });
  }

  if (!session) {
    throw new Error('夸克网盘播放信息恢复失败');
  }

  return { session, cookie: quarkConfig.Cookie, savePath: quarkConfig.SavePath || '/' };
}
