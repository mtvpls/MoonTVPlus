import { getConfig } from '@/lib/config';

import { listBaiduShareVideos } from './baidu.client';
import {
  createBaiduNetdiskSession,
  getBaiduNetdiskSession,
  parseBaiduNetdiskId,
  refreshBaiduNetdiskSession,
} from './baidu-session-cache';

export async function resolveBaiduSession(id: string) {
  const config = await getConfig();
  const baiduConfig = config.NetDiskConfig?.Baidu;
  if (!baiduConfig?.Enabled || !baiduConfig.Cookie) {
    throw new Error('百度网盘未配置或未启用');
  }

  let session = refreshBaiduNetdiskSession(id) || getBaiduNetdiskSession(id);
  if (!session) {
    const payload = parseBaiduNetdiskId(id);
    const result = await listBaiduShareVideos(payload.shareUrl, baiduConfig.Cookie, payload.passcode || '');
    session = createBaiduNetdiskSession({
      title: result.title,
      shareUrl: payload.shareUrl,
      passcode: payload.passcode,
      files: result.files,
      meta: result.meta,
      cookie: result.cookie,
    });
  }

  if (!session) {
    throw new Error('百度网盘播放信息恢复失败');
  }

  return { session, cookie: session.cookie || baiduConfig.Cookie };
}
