import { getConfig } from '@/lib/config';

import { listPan115ShareVideos } from './pan115.client';
import {
  createPan115NetdiskSession,
  getPan115NetdiskSession,
  parsePan115NetdiskId,
  refreshPan115NetdiskSession,
} from './pan115-session-cache';

export async function resolvePan115Session(id: string) {
  const config = await getConfig();
  const pan115Config = config.NetDiskConfig?.Pan115;
  if (!pan115Config?.Enabled || !pan115Config.Cookie) {
    throw new Error('115网盘未配置或未启用');
  }

  let session = refreshPan115NetdiskSession(id) || getPan115NetdiskSession(id);
  if (!session) {
    const payload = parsePan115NetdiskId(id);
    const result = await listPan115ShareVideos(payload.shareUrl, payload.passcode || '');
    session = createPan115NetdiskSession({
      title: result.title,
      shareUrl: payload.shareUrl,
      passcode: payload.passcode,
      files: result.files,
    });
  }

  if (!session) {
    throw new Error('115网盘播放信息恢复失败');
  }

  return { session, cookie: pan115Config.Cookie };
}
