import { getConfig } from '@/lib/config';

import { listPan123ShareVideos } from './pan123.client';
import {
  createPan123NetdiskSession,
  getPan123NetdiskSession,
  parsePan123NetdiskId,
  refreshPan123NetdiskSession,
} from './pan123-session-cache';

export async function resolvePan123Session(id: string) {
  const config = await getConfig();
  const pan123Config = config.NetDiskConfig?.Pan123;
  if (!pan123Config?.Enabled || !pan123Config.Account || !pan123Config.Password) {
    throw new Error('123网盘未配置或未启用');
  }

  let session = refreshPan123NetdiskSession(id) || getPan123NetdiskSession(id);
  if (!session) {
    const payload = parsePan123NetdiskId(id);
    const result = await listPan123ShareVideos(payload.shareUrl, payload.passcode || '');
    session = createPan123NetdiskSession({
      title: result.title,
      shareUrl: payload.shareUrl,
      passcode: payload.passcode,
      files: result.files,
    });
  }

  if (!session) {
    throw new Error('123网盘播放信息恢复失败');
  }

  return {
    session,
    account: pan123Config.Account,
    password: pan123Config.Password,
  };
}
