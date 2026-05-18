import { getConfig } from '@/lib/config';

import { listUCShareVideos } from './uc.client';
import {
  createUCNetdiskSession,
  getUCNetdiskSession,
  parseUCNetdiskId,
  refreshUCNetdiskSession,
} from './uc-session-cache';

export async function resolveUCSession(id: string) {
  const config = await getConfig();
  const ucConfig = config.NetDiskConfig?.UC;
  if (!ucConfig?.Enabled || !ucConfig.Cookie) {
    throw new Error('UC网盘未配置或未启用');
  }

  let session = refreshUCNetdiskSession(id) || getUCNetdiskSession(id);
  if (!session) {
    const payload = parseUCNetdiskId(id);
    const result = await listUCShareVideos(payload.shareUrl, ucConfig.Cookie, payload.passcode || '');
    session = createUCNetdiskSession({
      title: result.title,
      shareUrl: payload.shareUrl,
      passcode: payload.passcode,
      shareId: result.shareId,
      shareToken: result.shareToken,
      files: result.files,
    });
  }

  if (!session) {
    throw new Error('UC网盘播放信息恢复失败');
  }

  return {
    session,
    cookie: ucConfig.Cookie,
    token: ucConfig.Token || '',
    savePath: ucConfig.SavePath || '/',
  };
}
