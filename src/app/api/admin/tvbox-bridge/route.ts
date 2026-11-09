/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  getTVBoxBridgeBiliCredential,
  getTVBoxBridgeEndpoint,
  getTVBoxBridgeNetdiskCredentials,
  getTVBoxBridgeStatus,
  listTVBoxBridgeSites,
  loadTVBoxBridgeConfig,
  loadTVBoxBridgeSite,
  setTVBoxBridgeBiliCredential,
  setTVBoxBridgeNetdiskCredential,
} from '@/lib/tvbox-bridge.server';
import {
  isTVBoxBridgeLocalSite,
  TVBoxBridgeSiteInfo,
} from '@/lib/tvbox-bridge.shared';
import {
  clearTVBoxLiveSources,
  syncTVBoxLiveSources,
} from '@/lib/tvbox-live.server';
import { normalizeApiBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';

async function assertAdmin(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) return null;
  if (authInfo.username === process.env.USERNAME) return authInfo.username;

  const userInfoV2 = await db.getUserInfoV2(authInfo.username);
  if (
    !userInfoV2 ||
    (userInfoV2.role !== 'admin' && userInfoV2.role !== 'owner') ||
    userInfoV2.banned
  ) {
    return null;
  }
  return authInfo.username;
}

/** 合并写入 TVBoxBridgeConfig（只覆盖传入的字段） */
async function patchBridgeConfig(patch: Record<string, any>) {
  const config = await getConfig();
  config.TVBoxBridgeConfig = {
    Enabled: false,
    BaseUrl: '',
    Token: '',
    Sites: [],
    BlockedLocalSites: [],
    ...(config.TVBoxBridgeConfig || {}),
    ...patch,
  };
  config.TVBoxBridgeConfig.BaseUrl = normalizeApiBaseUrl(
    config.TVBoxBridgeConfig.BaseUrl
  );
  await db.saveAdminConfig(config);
  await setCachedConfig(config);
  return config.TVBoxBridgeConfig;
}

/** 更新已发现的站点，保留视频源管理中保存的开关与权重。 */
function buildSiteCatalog(
  sites: TVBoxBridgeSiteInfo[],
  local: AdminConfig['TVBoxBridgeConfig']
) {
  const previous = new Map(
    (local?.Sites || []).map((site) => [site.key, site])
  );
  const currentKeys = new Set(sites.map((site) => site.key));
  const blocked = new Set(
    (local?.BlockedLocalSites || []).filter((key) => !currentKeys.has(key))
  );
  const Sites = sites.map((site) => {
    const old = previous.get(site.key);
    const isLocal = isTVBoxBridgeLocalSite(site);
    if (isLocal) blocked.add(site.key);
    return {
      key: site.key,
      name: site.name || site.key,
      api: site.api,
      unsupported: site.unsupported,
      searchable: site.searchable,
      enabled: isLocal ? false : old?.enabled !== false,
      weight: old?.weight ?? 0,
    };
  });
  const order = new Map(
    (local?.Sites || []).map((site, index) => [site.key, index])
  );
  Sites.sort(
    (a, b) =>
      (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
  );
  return { Sites, BlockedLocalSites: Array.from(blocked) };
}

/**
 * GET /api/admin/tvbox-bridge
 * 面板首屏数据：本地配置 + 桥接状态 + 当前配置的站点列表。
 */
export async function GET(request: NextRequest) {
  const username = await assertAdmin(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await getConfig();
    let local = config.TVBoxBridgeConfig || null;

    const endpoint = await getTVBoxBridgeEndpoint();
    if (!endpoint) {
      return NextResponse.json(
        { config: local, endpoint: null, status: null, sites: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const status = await getTVBoxBridgeStatus(endpoint);
    let sites: TVBoxBridgeSiteInfo[] = [];
    let catalogChanged = false;
    if (status?.configLoaded) {
      try {
        sites = await listTVBoxBridgeSites(endpoint);
        const latest = (await getConfig()).TVBoxBridgeConfig;
        const catalog = buildSiteCatalog(sites, latest);
        catalogChanged =
          JSON.stringify(catalog.Sites) !==
            JSON.stringify(latest?.Sites || []) ||
          JSON.stringify(catalog.BlockedLocalSites) !==
            JSON.stringify(latest?.BlockedLocalSites || []);
        if (catalogChanged) local = await patchBridgeConfig(catalog);
      } catch (error) {
        console.warn('[TVBoxBridgeAdmin] 获取站点列表失败:', error);
      }
    }

    return NextResponse.json(
      { config: local, endpoint, status, sites, catalogChanged },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/tvbox-bridge
 * action: save | load-config | depot-pick | site-load |
 *         credentials-netdisk-get | credentials-netdisk-set | credentials-bili-get | credentials-bili-set
 */
export async function POST(request: NextRequest) {
  const username = await assertAdmin(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效的请求体' }, { status: 400 });
  }

  const action = body?.action;

  try {
    if (action === 'save') {
      // 这里只保存桥接连接配置，源开关与权重由视频源管理接口保存。
      const local = (await getConfig()).TVBoxBridgeConfig;
      const patch: Record<string, any> = {};
      if (typeof body.Enabled === 'boolean') patch.Enabled = body.Enabled;
      if (typeof body.BaseUrl === 'string') patch.BaseUrl = body.BaseUrl;
      if (typeof body.Token === 'string') patch.Token = body.Token;
      if (Array.isArray(body.BlockedLocalSites)) {
        // 面板不再手动管理屏蔽名单，保留兼容但只做合并，不覆盖服务端自动屏蔽项
        patch.BlockedLocalSites = Array.from(
          new Set([
            ...(local?.BlockedLocalSites || []),
            ...body.BlockedLocalSites.filter(
              (key: any) => typeof key === 'string' && key
            ),
          ])
        );
      }
      if (typeof body.ConfigUrl === 'string') patch.ConfigUrl = body.ConfigUrl;
      if (typeof body.SelectedDepotUrl === 'string') {
        patch.SelectedDepotUrl = body.SelectedDepotUrl;
      }

      const saved = await patchBridgeConfig(patch);
      return NextResponse.json({ success: true, config: saved });
    }

    const endpoint = await getTVBoxBridgeEndpoint();
    if (!endpoint) {
      return NextResponse.json(
        { error: 'TVBox 桥接未启用或未填写地址' },
        { status: 400 }
      );
    }

    if (action === 'status') {
      const status = await getTVBoxBridgeStatus(endpoint);
      if (!status) {
        return NextResponse.json({ error: '桥接不可达' }, { status: 502 });
      }
      return NextResponse.json({ success: true, status });
    }

    if (action === 'sites') {
      const sites = await listTVBoxBridgeSites(endpoint);
      const local = (await getConfig()).TVBoxBridgeConfig;
      await patchBridgeConfig(buildSiteCatalog(sites, local));
      return NextResponse.json({ success: true, sites });
    }

    /**
     * 加载 / 更新配置。只在管理员点按钮（或 status 显示未加载）时调用：
     * 桥接成功后自己持久化快照，本地不重复拉取。
     */
    if (action === 'load-config') {
      const url = String(body.url || '').trim();
      if (!url) {
        return NextResponse.json({ error: '请填写配置地址' }, { status: 400 });
      }

      const result = await loadTVBoxBridgeConfig(endpoint, url);

      if (result.kind === 'depot') {
        // 保留多仓地址与列表，选定具体仓库后仍可恢复选择。
        await patchBridgeConfig({
          ConfigUrl: url,
          SelectedDepotUrl: '',
          Depot: {
            configUrl: result.configUrl || url,
            entries: result.entries || [],
          },
        });
        await clearTVBoxLiveSources();
        return NextResponse.json({ success: true, result });
      }

      const local = (await getConfig()).TVBoxBridgeConfig;
      const catalog = buildSiteCatalog(result.sites || [], local);

      await patchBridgeConfig({
        ConfigUrl: url,
        SelectedDepotUrl: '',
        Depot: null,
        ...catalog,
      });
      let liveSyncError: string | undefined;
      try {
        await syncTVBoxLiveSources(true);
      } catch (error) {
        liveSyncError = (error as Error).message;
      }
      return NextResponse.json({ success: true, result, liveSyncError });
    }

    if (action === 'depot-pick') {
      const url = String(body.url || '').trim();
      if (!url) {
        return NextResponse.json({ error: '请选择仓库' }, { status: 400 });
      }

      const result = await loadTVBoxBridgeConfig(endpoint, url);
      if (result.kind === 'depot') {
        // 多仓可以嵌套，继续展示子仓列表，直到选到具体配置。
        await patchBridgeConfig({
          SelectedDepotUrl: '',
          Depot: {
            configUrl: result.configUrl || url,
            entries: result.entries || [],
          },
        });
        await clearTVBoxLiveSources();
        return NextResponse.json({ success: true, result });
      }

      const local = (await getConfig()).TVBoxBridgeConfig;
      const catalog = buildSiteCatalog(result.sites || [], local);

      await patchBridgeConfig({
        SelectedDepotUrl: url,
        ...catalog,
      });
      let liveSyncError: string | undefined;
      try {
        await syncTVBoxLiveSources(true);
      } catch (error) {
        liveSyncError = (error as Error).message;
      }
      return NextResponse.json({ success: true, result, liveSyncError });
    }

    // 预热单个站点（首次约 1 分钟）。仅供手动操作，不做自动调用。
    if (action === 'site-load') {
      const key = String(body.key || '').trim();
      if (!key) {
        return NextResponse.json({ error: '缺少站点 key' }, { status: 400 });
      }
      const result = await loadTVBoxBridgeSite(endpoint, key);
      return NextResponse.json({ success: true, result });
    }

    if (action === 'credentials-netdisk-get') {
      const key = String(body.key || '').trim();
      if (!key) {
        return NextResponse.json({ error: '缺少站点 key' }, { status: 400 });
      }
      const providers = await getTVBoxBridgeNetdiskCredentials(endpoint, key);
      return NextResponse.json({ success: true, providers });
    }

    if (action === 'credentials-netdisk-set') {
      const key = String(body.key || '').trim();
      const provider = body.provider;
      if (!key || !['quark', 'uc', 'ali'].includes(provider)) {
        return NextResponse.json({ error: '缺少参数' }, { status: 400 });
      }
      const result = await setTVBoxBridgeNetdiskCredential(endpoint, {
        key,
        provider,
        cookie: typeof body.cookie === 'string' ? body.cookie : undefined,
        token: typeof body.token === 'string' ? body.token : undefined,
      });
      return NextResponse.json({ success: true, result });
    }

    if (action === 'credentials-bili-get') {
      const status = await getTVBoxBridgeBiliCredential(endpoint);
      return NextResponse.json({ success: true, status });
    }

    if (action === 'credentials-bili-set') {
      const cookie = typeof body.cookie === 'string' ? body.cookie : '';
      const status = await setTVBoxBridgeBiliCredential(endpoint, cookie);
      return NextResponse.json({ success: true, status });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
