/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Cloud,
  Download,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import {
  isTVBoxBridgeLocalSite,
  TVBOX_BRIDGE_NETDISK_PROVIDERS,
  TVBoxBridgeCredentialInfo,
  TVBoxBridgeDepotInfo,
  TVBoxBridgeSiteInfo,
  TVBoxBridgeStatusInfo,
} from '@/lib/tvbox-bridge.shared';

import Toast, { ToastProps } from './Toast';
import TVBoxBridgeDeployDialog from './TVBoxBridgeDeployDialog';

interface TVBoxBridgeAdminComponentProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

type SectionKey = 'sites' | 'credentials';

const buttonStyles = {
  primary:
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors',
  success:
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors',
  secondary:
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors',
  outline:
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 rounded-lg transition-colors',
  dangerSmall:
    'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-200 rounded-md transition-colors',
};

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500';

const Switch = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <button
    type='button'
    role='switch'
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const SectionTitle = ({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <div className='flex items-start gap-3'>
    <div className='mt-0.5 text-gray-500 dark:text-gray-400'>{icon}</div>
    <div>
      <h3 className='text-sm font-semibold text-gray-900 dark:text-white'>
        {title}
      </h3>
      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>{desc}</p>
    </div>
  </div>
);

const Badge = ({
  children,
  tone = 'gray',
}: {
  children: React.ReactNode;
  tone?: 'gray' | 'green' | 'red' | 'blue' | 'amber';
}) => {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300',
    green:
      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
};

export default function TVBoxBridgeAdminComponent({
  config,
  refreshConfig,
}: TVBoxBridgeAdminComponentProps) {
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [toast, setToast] = useState<ToastProps | null>(null);
  const notify = (message: string, type: ToastProps['type'] = 'info') =>
    setToast({ message, type, onClose: () => setToast(null) });

  // 连接设置
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [savingConnection, setSavingConnection] = useState(false);

  // 桥接实时数据
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<TVBoxBridgeStatusInfo | null>(null);
  const [sites, setSites] = useState<TVBoxBridgeSiteInfo[]>([]);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // 配置地址 / 多仓
  const [configUrl, setConfigUrl] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [depot, setDepot] = useState<TVBoxBridgeDepotInfo | null>(null);
  const [selectedDepotUrl, setSelectedDepotUrl] = useState('');
  const [pickingDepotUrl, setPickingDepotUrl] = useState<string | null>(null);

  const [loadingSiteKey, setLoadingSiteKey] = useState<string | null>(null);

  // 本地文件屏蔽由服务端自动维护，面板只读展示数量
  const blockedLocalCount =
    config?.TVBoxBridgeConfig?.BlockedLocalSites?.length || 0;

  // 登录配置
  const [credentialKey, setCredentialKey] = useState<string | null>(null);
  const [credentialProviders, setCredentialProviders] = useState<
    Record<string, TVBoxBridgeCredentialInfo>
  >({});
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState<{
    provider: 'quark' | 'uc' | 'ali';
    value: string;
  }>({ provider: 'quark', value: '' });
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [biliStatus, setBiliStatus] =
    useState<TVBoxBridgeCredentialInfo | null>(null);
  const [biliCookie, setBiliCookie] = useState('');
  const [biliSaving, setBiliSaving] = useState(false);

  const [activeSection, setActiveSection] = useState<SectionKey>('sites');

  // ---------- 初始化：读本地配置 ----------
  useEffect(() => {
    const bridge = config?.TVBoxBridgeConfig;
    if (!bridge) return;
    setEnabled(Boolean(bridge.Enabled));
    setBaseUrl(bridge.BaseUrl || '');
    setToken(bridge.Token || '');
    setConfigUrl(bridge.ConfigUrl || '');
    setDepot(bridge.Depot || null);
    setSelectedDepotUrl(bridge.SelectedDepotUrl || '');
  }, [config]);

  // ---------- 初始化：读桥接状态与站点 ----------
  const fetchBridge = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetch('/api/admin/tvbox-bridge', {
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '读取桥接状态失败');

        setStatus(data.status || null);
        setLoadError(null);

        // 本地文件类来源（file:// 等）桥接读不到，一律屏蔽，面板不展示
        const allSites: TVBoxBridgeSiteInfo[] = Array.isArray(data.sites)
          ? data.sites
          : [];
        setSites(
          allSites.filter((site) => !isTVBoxBridgeLocalSite({ api: site.api }))
        );

        if (data.catalogChanged) await refreshConfig();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : '读取失败');
        setStatus(null);
        setSites([]);
      } finally {
        setLoading(false);
      }
    },
    [refreshConfig]
  );

  useEffect(() => {
    fetchBridge();
  }, [fetchBridge]);

  // ---------- 保存连接设置 ----------
  const saveConnection = async () => {
    setSavingConnection(true);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          Enabled: enabled,
          BaseUrl: baseUrl,
          Token: token,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存失败');
      notify('连接设置已保存', 'success');
      await refreshConfig();
      await fetchBridge();
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingConnection(false);
    }
  };

  // ---------- 查看状态 ----------
  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '桥接不可达');
      setStatus(data.status);
      notify('桥接在线', 'success');
      await fetchBridge(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '桥接不可达', 'error');
    } finally {
      setCheckingStatus(false);
    }
  };

  // ---------- 加载 / 更新配置 ----------
  const loadConfig = async () => {
    if (!configUrl.trim()) {
      notify('请填写 TVBox 配置地址', 'error');
      return;
    }
    setLoadingConfig(true);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load-config', url: configUrl.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '加载配置失败');

      setSelectedDepotUrl('');
      if (data.result?.kind === 'depot') {
        setDepot({
          configUrl: data.result.configUrl || configUrl.trim(),
          entries: data.result.entries || [],
        });
        notify('这是多仓配置，请选择一个仓库', 'info');
      } else {
        setDepot(null);
        notify(`配置已加载：${data.result?.siteCount ?? 0} 个站点，${data.result?.liveCount ?? 0} 个直播源`, 'success');
        if (data.liveSyncError) notify(`直播源读取失败：${data.liveSyncError}`, 'error');
      }
      await refreshConfig();
      await fetchBridge(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载配置失败', 'error');
    } finally {
      setLoadingConfig(false);
    }
  };

  const pickDepot = async (url: string) => {
    setPickingDepotUrl(url);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'depot-pick', url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '载入仓库失败');
      if (data.result?.kind === 'depot') {
        setDepot({
          configUrl: data.result.configUrl || url,
          entries: data.result.entries || [],
        });
        setSelectedDepotUrl('');
        notify('这是多仓配置，请继续选择一个仓库', 'info');
      } else {
        setSelectedDepotUrl(url);
        notify(
          `仓库已载入：${data.result?.siteCount ?? 0} 个站点，${
            data.result?.liveCount ?? 0
          } 个直播源`,
          'success'
        );
        if (data.liveSyncError)
          notify(`直播源读取失败：${data.liveSyncError}`, 'error');
      }
      await refreshConfig();
      await fetchBridge(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '载入仓库失败', 'error');
    } finally {
      setPickingDepotUrl(null);
    }
  };

  // ---------- 站点预热 ----------
  const loadSite = async (key: string) => {
    setLoadingSiteKey(key);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'site-load', key }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '预热失败');
      if (data.result?.ok === false) {
        throw new Error(data.result.error || '预热失败');
      }
      notify('站点已预热', 'success');
      await fetchBridge(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '预热失败', 'error');
    } finally {
      setLoadingSiteKey(null);
    }
  };

  // ---------- 登录配置 ----------
  const credentialGroups = useMemo(() => {
    const map = new Map<
      string,
      { jarKey: string; sites: TVBoxBridgeSiteInfo[] }
    >();
    sites.forEach((site) => {
      if (!site.loginSiteKey) return;
      const jarKey = site.loginSiteKey;
      const group = map.get(jarKey) || { jarKey, sites: [] };
      group.sites.push(site);
      map.set(jarKey, group);
    });
    return Array.from(map.values());
  }, [sites]);

  const openCredentials = async (jarKey: string, siteKey: string) => {
    setCredentialKey(jarKey);
    setCredentialLoading(true);
    setCredentialProviders({});
    setCredentialDraft({ provider: 'quark', value: '' });
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'credentials-netdisk-get',
          key: siteKey,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取凭据状态失败');
      setCredentialProviders(data.providers || {});
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '读取凭据状态失败',
        'error'
      );
    } finally {
      setCredentialLoading(false);
    }
  };

  const saveCredential = async (siteKey: string) => {
    if (!credentialDraft.value.trim()) {
      notify('请填写 Cookie 或 Token', 'error');
      return;
    }
    setCredentialSaving(true);
    try {
      const isAli = credentialDraft.provider === 'ali';
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'credentials-netdisk-set',
          key: siteKey,
          provider: credentialDraft.provider,
          ...(isAli
            ? { token: credentialDraft.value.trim() }
            : { cookie: credentialDraft.value.trim() }),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存凭据失败');
      notify('凭据已写入桥接', 'success');
      setCredentialDraft((prev) => ({ ...prev, value: '' }));
      await openCredentials(credentialKey || '', siteKey);
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存凭据失败', 'error');
    } finally {
      setCredentialSaving(false);
    }
  };

  const loadBili = async () => {
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'credentials-bili-get' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取 B 站凭据失败');
      setBiliStatus(data.status || null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '读取 B 站凭据失败',
        'error'
      );
    }
  };

  const saveBili = async (cookie: string) => {
    setBiliSaving(true);
    try {
      const response = await fetch('/api/admin/tvbox-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'credentials-bili-set', cookie }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存失败');
      setBiliStatus(data.status || null);
      setBiliCookie('');
      notify(cookie ? 'B 站 Cookie 已保存' : 'B 站 Cookie 已清除', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setBiliSaving(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'credentials') loadBili();
  }, [activeSection]);

  // ---------- 渲染 ----------
  const sections: Array<{
    key: SectionKey;
    title: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      key: 'sites',
      title: '站点',
      icon: <Server size={16} />,
      count: sites.length,
    },
    {
      key: 'credentials',
      title: '登录配置',
      icon: <KeyRound size={16} />,
      count: credentialGroups.length,
    },
  ];

  return (
    <div className='space-y-6'>
      {/* 连接设置 */}
      <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
        <h3 className='mb-2 text-sm font-medium text-blue-900 dark:text-blue-100'>
          关于 TVBox 桥接
        </h3>
        <div className='space-y-1 text-sm text-blue-800 dark:text-blue-200'>
          <p>• 该功能目前属于实验性功能，无法保证所有 TVBox 源均可使用</p>
          <p>• 同一部影片的多个「线路」在换源面板内切换</p>
          <p>• 配置由桥接自己持久化，这里只在改动时手动加载</p>
        </div>
        <button
          type='button'
          onClick={() => setShowDeployGuide(true)}
          aria-haspopup='dialog'
          className='mt-3 inline-flex items-center gap-1.5 rounded text-sm font-medium text-blue-700 underline underline-offset-4 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-300 dark:hover:text-blue-100'
        >
          <BookOpen size={16} aria-hidden='true' />
          查看部署教程
        </button>
      </div>

      <div className='space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              启用 TVBox 桥接
            </h3>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              关闭后所有 tvbox 源从搜索与详情中消失
            </p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              桥接地址
            </label>
            <input
              type='text'
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder='http://127.0.0.1:8787'
              className={inputClass}
            />
          </div>
          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              Token
            </label>
            <input
              type='password'
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder='可选'
              className={inputClass}
            />
          </div>
        </div>

        <div className='flex flex-wrap gap-3'>
          <button
            onClick={saveConnection}
            disabled={savingConnection}
            className={buttonStyles.success}
          >
            {savingConnection ? (
              <Loader2 size={16} className='animate-spin' />
            ) : (
              <Save size={16} />
            )}
            保存连接设置
          </button>
          <button
            onClick={checkStatus}
            disabled={checkingStatus}
            className={buttonStyles.outline}
          >
            {checkingStatus ? (
              <Loader2 size={16} className='animate-spin' />
            ) : (
              <RefreshCw size={16} />
            )}
            查看状态
          </button>
        </div>

        {/* 状态 */}
        {loading ? (
          <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
            <Loader2 size={16} className='animate-spin' />
            正在读取桥接状态...
          </div>
        ) : loadError ? (
          <div className='flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'>
            <AlertCircle size={16} className='mt-0.5 flex-shrink-0' />
            <div>
              <p>{loadError}</p>
              <p className='mt-1 text-xs opacity-80'>
                桥接不可达时 tvbox 源会被静默跳过，不影响其他源。
              </p>
            </div>
          </div>
        ) : status ? (
          <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300'>
            <span className='inline-flex items-center gap-1'>
              <CheckCircle2 size={14} className='text-green-500' />
              在线 v{status.version}
            </span>
            <span>鉴权：{status.auth ? '已开启' : '未开启'}</span>
            <span>
              配置：
              {status.configLoaded ? '已加载' : '未加载'}
              {status.sites ? `（${status.sites} 站点）` : ''}
            </span>
            {status.companion && (
              <span>
                Companion：
                {status.companion.running ? '运行中' : '未运行'}
                {status.companion.port ? ` :${status.companion.port}` : ''}
              </span>
            )}
          </div>
        ) : (
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            未获取到桥接状态
          </p>
        )}
      </div>

      {/* 配置地址 */}
      <div className='space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
        <SectionTitle
          icon={<Download size={18} />}
          title='TVBox 配置'
          desc='填写配置地址后点「加载/更新配置」。桥接会自己保存快照，重启无需重新加载。'
        />
        <div className='flex flex-col gap-3 sm:flex-row'>
          <input
            type='text'
            value={configUrl}
            onChange={(e) => setConfigUrl(e.target.value)}
            disabled={loadingConfig || !!pickingDepotUrl}
            placeholder='请输入 TVBox 配置地址'
            className={inputClass}
          />
          <button
            onClick={loadConfig}
            disabled={loadingConfig || !!pickingDepotUrl}
            className={`${buttonStyles.primary} flex-shrink-0`}
          >
            {loadingConfig ? (
              <Loader2 size={16} className='animate-spin' />
            ) : (
              <Download size={16} />
            )}
            {status?.configLoaded ? '更新配置' : '加载配置'}
          </button>
        </div>
        {!status?.configLoaded && !loading && (
          <p className='text-xs text-amber-600 dark:text-amber-400'>
            桥接当前尚未加载任何配置，请先加载一次。
          </p>
        )}

        {/* 多仓选择 */}
        {depot && (
          <div className='rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 dark:border-gray-700 dark:text-white'>
              {selectedDepotUrl
                ? '仓库列表，可选择其他仓库切换'
                : '这是一个多仓配置，请选择仓库'}
            </div>
            <div className='max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800'>
              {depot.entries.map((entry) => (
                <div
                  key={entry.url}
                  className='flex items-center justify-between gap-3 px-3 py-2'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm text-gray-900 dark:text-white'>
                      {entry.name || entry.url}
                      {selectedDepotUrl === entry.url && (
                        <span className='ml-2'>
                          <Badge tone='green'>当前仓库</Badge>
                        </span>
                      )}
                    </p>
                    <p className='truncate text-xs text-gray-400'>
                      {entry.url}
                    </p>
                  </div>
                  <button
                    type='button'
                    onClick={() => pickDepot(entry.url)}
                    disabled={loadingConfig || !!pickingDepotUrl}
                    className={`${buttonStyles.primary} flex-shrink-0`}
                  >
                    {pickingDepotUrl === entry.url ? (
                      <Loader2 size={14} className='animate-spin' />
                    ) : null}
                    选择
                  </button>
                </div>
              ))}
              {depot.entries.length === 0 && (
                <p className='px-3 py-4 text-sm text-gray-500 dark:text-gray-400'>
                  仓库列表为空
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 分区 */}
      <div className='rounded-lg border border-gray-200 dark:border-gray-700'>
        {blockedLocalCount > 0 && (
          <p className='border-b border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400'>
            已自动屏蔽 {blockedLocalCount} 个本地文件类来源（接口为 file://
            或相对路径，桥接读不到），不会出现在搜索与详情中。
          </p>
        )}
        <div className='flex flex-wrap gap-1 border-b border-gray-200 p-2 dark:border-gray-700'>
          {sections.map((section) => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeSection === section.key
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {section.icon}
              {section.title}
              {typeof section.count === 'number' && (
                <span className='text-xs opacity-70'>({section.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* 站点 */}
        {activeSection === 'sites' && (
          <div className='space-y-3 p-4'>
            {sites.length === 0 ? (
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                暂无站点。请先加载 TVBox 配置。
              </p>
            ) : (
              <>
                <div className='divide-y divide-gray-100 dark:divide-gray-800'>
                  {sites.map((site) => {
                    return (
                      <div
                        key={site.key}
                        className='flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5'
                      >
                        <div className='min-w-0 w-full sm:w-auto sm:flex-1'>
                          <div className='flex flex-wrap items-center gap-1.5'>
                            <span className='min-w-0 break-all text-sm font-medium text-gray-900 dark:text-white'>
                              {site.name || site.key}
                            </span>
                            {site.engine && (
                              <Badge tone='blue'>{site.engine}</Badge>
                            )}
                            {site.unsupported && (
                              <Badge tone='red'>不支持</Badge>
                            )}
                            {site.searchable === 0 && (
                              <Badge tone='amber'>不可搜索</Badge>
                            )}
                          </div>
                          <p className='mt-0.5 break-all text-xs text-gray-400 line-clamp-2'>
                            {site.key}
                            {site.api ? ` · ${site.api}` : ''}
                          </p>
                        </div>

                        <div className='ml-auto flex items-center gap-2'>
                          <button
                            onClick={() => loadSite(site.key)}
                            disabled={loadingSiteKey === site.key || !site.api}
                            className={buttonStyles.outline}
                            title='Spider 站点首次预热约需 1 分钟'
                          >
                            {loadingSiteKey === site.key ? (
                              <Loader2 size={14} className='animate-spin' />
                            ) : (
                              <Play size={14} />
                            )}
                            预热
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* 登录配置 */}
        {activeSection === 'credentials' && (
          <div className='space-y-4 p-4'>
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              带登录的网盘类来源需要 Cookie /
              Token。凭据只透传给桥接，本站不保存。 同一个 jar
              下的站点共用一份登录配置。
            </p>

            {credentialGroups.length === 0 ? (
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                当前配置里没有需要登录的来源。
              </p>
            ) : (
              <div className='space-y-3'>
                {credentialGroups.map((group) => {
                  const expanded = credentialKey === group.jarKey;
                  const siteKey = group.sites[0]?.key || '';
                  return (
                    <div
                      key={group.jarKey}
                      className='rounded-lg border border-gray-200 dark:border-gray-700'
                    >
                      <button
                        onClick={() =>
                          expanded
                            ? setCredentialKey(null)
                            : openCredentials(group.jarKey, siteKey)
                        }
                        className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left'
                      >
                        <div className='min-w-0'>
                          <p className='truncate text-sm font-medium text-gray-900 dark:text-white'>
                            {group.sites.map((site) => site.name).join(' / ')}
                          </p>
                          <p className='truncate text-xs text-gray-400'>
                            jar: {group.jarKey}
                          </p>
                        </div>
                        <Cloud
                          size={16}
                          className='flex-shrink-0 text-gray-400'
                        />
                      </button>

                      {expanded && (
                        <div className='space-y-3 border-t border-gray-200 p-3 dark:border-gray-700'>
                          {credentialLoading ? (
                            <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                              <Loader2 size={14} className='animate-spin' />
                              正在读取凭据状态...
                            </div>
                          ) : (
                            <>
                              <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                                {TVBOX_BRIDGE_NETDISK_PROVIDERS.map(
                                  (provider) => {
                                    const info =
                                      credentialProviders[provider.key];
                                    return (
                                      <div
                                        key={provider.key}
                                        className='flex items-center justify-between rounded-md border border-gray-200 px-2 py-1.5 dark:border-gray-700'
                                      >
                                        <span className='text-xs text-gray-700 dark:text-gray-300'>
                                          {provider.label}
                                        </span>
                                        {info?.configured ? (
                                          <span className='inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400'>
                                            <CheckCircle2 size={12} />
                                            已配置
                                          </span>
                                        ) : (
                                          <span className='inline-flex items-center gap-1 text-xs text-gray-400'>
                                            <XCircle size={12} />
                                            未配置
                                          </span>
                                        )}
                                      </div>
                                    );
                                  }
                                )}
                              </div>

                              <div className='space-y-2'>
                                <div className='flex flex-wrap gap-1.5'>
                                  {TVBOX_BRIDGE_NETDISK_PROVIDERS.map(
                                    (provider) => (
                                      <button
                                        key={provider.key}
                                        onClick={() =>
                                          setCredentialDraft((prev) => ({
                                            ...prev,
                                            provider: provider.key,
                                          }))
                                        }
                                        className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                                          credentialDraft.provider ===
                                          provider.key
                                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
                                        }`}
                                      >
                                        {provider.label}
                                      </button>
                                    )
                                  )}
                                </div>
                                <textarea
                                  value={credentialDraft.value}
                                  onChange={(e) =>
                                    setCredentialDraft((prev) => ({
                                      ...prev,
                                      value: e.target.value,
                                    }))
                                  }
                                  rows={3}
                                  placeholder={
                                    credentialDraft.provider === 'ali'
                                      ? '32 位 refresh_token'
                                      : '完整 Cookie（含 __pus）'
                                  }
                                  className={`${inputClass} font-mono text-xs`}
                                />
                                <div className='flex gap-2'>
                                  <button
                                    onClick={() => saveCredential(siteKey)}
                                    disabled={credentialSaving}
                                    className={buttonStyles.success}
                                  >
                                    {credentialSaving ? (
                                      <Loader2
                                        size={14}
                                        className='animate-spin'
                                      />
                                    ) : (
                                      <Save size={14} />
                                    )}
                                    写入凭据
                                  </button>
                                  <p className='self-center text-xs text-gray-400'>
                                    只透传给桥接，本地不留存
                                  </p>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* B 站 Cookie */}
            <div className='rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm font-medium text-gray-900 dark:text-white'>
                    B 站 Cookie
                  </p>
                  <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
                    番剧类来源解析需要登录态
                  </p>
                </div>
                {biliStatus?.configured ? (
                  <Badge tone='green'>已配置</Badge>
                ) : (
                  <Badge>未配置</Badge>
                )}
              </div>
              <textarea
                value={biliCookie}
                onChange={(e) => setBiliCookie(e.target.value)}
                rows={3}
                placeholder='SESSDATA=...; bili_jct=...'
                className={`${inputClass} mt-2 font-mono text-xs`}
              />
              <div className='mt-2 flex flex-wrap gap-2'>
                <button
                  onClick={() => saveBili(biliCookie.trim())}
                  disabled={biliSaving || !biliCookie.trim()}
                  className={buttonStyles.success}
                >
                  {biliSaving ? (
                    <Loader2 size={14} className='animate-spin' />
                  ) : (
                    <Save size={14} />
                  )}
                  保存
                </button>
                <button
                  onClick={() => saveBili('')}
                  disabled={biliSaving || !biliStatus?.configured}
                  className={buttonStyles.dangerSmall}
                >
                  清除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className='flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400'>
        <ShieldCheck size={16} className='mt-0.5 flex-shrink-0' />
        <p>
          桥接 Token 与网盘凭据都只保存在服务端；管理页展示的 Token
          用于确认生效， 不会下发给普通用户。
        </p>
      </div>

      <TVBoxBridgeDeployDialog
        open={showDeployGuide}
        onClose={() => setShowDeployGuide(false)}
      />
      {toast && <Toast {...toast} />}
    </div>
  );
}
