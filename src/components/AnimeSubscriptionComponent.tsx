/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { AlertCircle, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { AnimeSubscription } from '@/types/anime-subscription';

interface AnimeSubscriptionComponentProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

// Switch 组件
const Switch = ({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) => (
  <button
    type='button'
    role='switch'
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 items-center rounded-full transition-colors
      ${checked ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'}
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
    `}
  >
    <span
      className={`
        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
        ${checked ? 'translate-x-6' : 'translate-x-1'}
      `}
    />
  </button>
);

// AlertModal 组件
interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  confirmText?: string;
  onConfirm?: () => void;
  showConfirm?: boolean;
}

const AlertModal = ({
  isOpen,
  onClose,
  type,
  title,
  message,
  confirmText = '确定',
  onConfirm,
  showConfirm = false,
}: AlertModalProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const icons = {
    success: <AlertCircle className="w-12 h-12 text-green-500" />,
    error: <AlertCircle className="w-12 h-12 text-red-500" />,
    warning: <AlertCircle className="w-12 h-12 text-yellow-500" />,
    info: <AlertCircle className="w-12 h-12 text-blue-500" />,
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          isVisible ? 'opacity-50' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 transition-all duration-300 ${
          isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="flex flex-col items-center text-center">
          {icons[type]}
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          {message && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {message}
            </p>
          )}

          <div className="flex justify-center space-x-3 mt-6">
            {showConfirm && onConfirm ? (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  {confirmText}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                {confirmText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default function AnimeSubscriptionComponent({
  config,
  refreshConfig,
}: AnimeSubscriptionComponentProps) {
  const [enabled, setEnabled] = useState(false);
  const [subscriptions, setSubscriptions] = useState<AnimeSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<AnimeSubscription | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message?: string;
    confirmText?: string;
    onConfirm?: () => void;
    showConfirm?: boolean;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal(prev => ({ ...prev, isOpen: false }));
  };

  // 表单状态
  const [formData, setFormData] = useState({
    title: '',
    filterText: '',
    source: 'mikan' as 'acgrip' | 'mikan' | 'dmhy',
    lastEpisode: 0,
    enabled: true,
  });

  // 加载配置
  useEffect(() => {
    if (config?.AnimeSubscriptionConfig) {
      setEnabled(config.AnimeSubscriptionConfig.Enabled || false);
      setSubscriptions(config.AnimeSubscriptionConfig.Subscriptions || []);
    }
  }, [config]);

  // 重置表单
  const resetForm = () => {
    setFormData({
      title: '',
      filterText: '',
      source: 'mikan',
      lastEpisode: 0,
      enabled: true,
    });
    setEditingSubscription(null);
    setShowAddForm(false);
  };

  // 切换启用状态
  const handleToggleEnabled = async (newEnabled: boolean) => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/anime-subscription/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (!response.ok) {
        throw new Error('切换状态失败');
      }

      setEnabled(newEnabled);
      await refreshConfig();
    } catch (error) {
      showAlert({
        type: 'error',
        title: '切换状态失败',
        message: error instanceof Error ? error.message : '切换状态失败',
      });
    } finally {
      setLoading(false);
    }
  };

  // 开始添加
  const handleAdd = () => {
    resetForm();
    setShowAddForm(true);
  };

  // 开始编辑
  const handleEdit = (sub: AnimeSubscription) => {
    setFormData({
      title: sub.title,
      filterText: sub.filterText,
      source: sub.source,
      lastEpisode: sub.lastEpisode,
      enabled: sub.enabled,
    });
    setEditingSubscription(sub);
    setShowAddForm(false);
  };

  // 保存订阅
  const handleSave = async () => {
    if (!formData.title.trim() || !formData.filterText.trim()) {
      showAlert({
        type: 'warning',
        title: '请填写必填字段',
        message: '番剧名称和过滤关键词不能为空',
      });
      return;
    }

    try {
      setLoading(true);

      if (editingSubscription) {
        // 更新
        const response = await fetch(`/api/admin/anime-subscription/${editingSubscription.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!response.ok) {
          throw new Error('更新订阅失败');
        }
      } else {
        // 创建
        const response = await fetch('/api/admin/anime-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!response.ok) {
          throw new Error('创建订阅失败');
        }
      }

      resetForm();
      await refreshConfig();
      showAlert({
        type: 'success',
        title: editingSubscription ? '订阅已更新' : '订阅已创建',
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: '保存失败',
        message: error instanceof Error ? error.message : '保存失败',
      });
    } finally {
      setLoading(false);
    }
  };

  // 删除订阅
  const handleDelete = async (id: string, title: string) => {
    showAlert({
      type: 'warning',
      title: '确认删除',
      message: `确定要删除订阅"${title}"吗？`,
      confirmText: '删除',
      showConfirm: true,
      onConfirm: async () => {
        try {
          setLoading(true);
          const response = await fetch(`/api/admin/anime-subscription/${id}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            throw new Error('删除订阅失败');
          }

          await refreshConfig();
          showAlert({
            type: 'success',
            title: '订阅已删除',
          });
        } catch (error) {
          showAlert({
            type: 'error',
            title: '删除失败',
            message: error instanceof Error ? error.message : '删除失败',
          });
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // 手动检查更新
  const handleCheckSubscription = async (id: string) => {
    try {
      setCheckingId(id);
      const response = await fetch(`/api/admin/anime-subscription/${id}/check`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('检查失败');
      }

      const result = await response.json();
      showAlert({
        type: 'success',
        title: '检查完成',
        message: `发现 ${result.found} 个新集数，已下载 ${result.downloaded} 个`,
      });
      await refreshConfig();
    } catch (error) {
      showAlert({
        type: 'error',
        title: '检查失败',
        message: error instanceof Error ? error.message : '检查失败',
      });
    } finally {
      setCheckingId(null);
    }
  };

  // 切换订阅启用状态
  const handleToggleSubscription = async (sub: AnimeSubscription) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/anime-subscription/${sub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !sub.enabled }),
      });

      if (!response.ok) {
        throw new Error('切换状态失败');
      }

      await refreshConfig();
    } catch (error) {
      showAlert({
        type: 'error',
        title: '切换状态失败',
        message: error instanceof Error ? error.message : '切换状态失败',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: number) => {
    if (!timestamp) return '从未';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  };

  return (
    <div className='space-y-6'>
      {/* 顶部控制 */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            启用追番功能
          </span>
          <Switch checked={enabled} onChange={handleToggleEnabled} disabled={loading} />
        </div>
        <button
          onClick={handleAdd}
          disabled={loading || showAddForm}
          className='flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50'
        >
          <Plus size={16} />
          添加订阅
        </button>
      </div>

      {/* 说明 */}
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <div className='flex gap-2'>
          <AlertCircle className='w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5' />
          <div className='text-sm text-blue-800 dark:text-blue-200 space-y-1'>
            <p>• 定时任务会自动检查订阅更新</p>
            <p>• 下载路径：OpenList离线下载根目录/番剧名称/</p>
            <p>• 过滤关键词支持多个，用逗号分隔，只会下载包含这些关键字的资源，可以用来过滤字幕组或是字幕种类</p>
            <p>• 当前集数：已看到第几集，只下载更新的集数</p>
          </div>
        </div>
      </div>

      {/* 添加/编辑表单 */}
      {(showAddForm || editingSubscription) && (
        <div className='bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
              {editingSubscription ? '编辑订阅' : '添加订阅'}
            </h3>
            <button
              onClick={resetForm}
              className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            >
              <X size={20} />
            </button>
          </div>
          <div className='space-y-4'>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  番剧名称 *
                </label>
                <input
                  type='text'
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder='葬送的芙莉莲'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  过滤关键词 *
                </label>
                <input
                  type='text'
                  value={formData.filterText}
                  onChange={(e) => setFormData({ ...formData, filterText: e.target.value })}
                  placeholder='简体,喵萌奶茶屋'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
                />
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  多个关键词用逗号分隔
                </p>
              </div>
            </div>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  搜索源
                </label>
                <select
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value as any })}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
                >
                  <option value='mikan'>蜜柑 (Mikan)</option>
                  <option value='acgrip'>ACG.RIP</option>
                  <option value='dmhy'>动漫花园 (DMHY)</option>
                </select>
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  当前集数
                </label>
                <input
                  type='number'
                  min='0'
                  value={formData.lastEpisode}
                  onChange={(e) => setFormData({ ...formData, lastEpisode: parseInt(e.target.value) || 0 })}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
                />
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  已看到第几集
                </p>
              </div>
            </div>
            <div className='flex items-center gap-3'>
              <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                启用此订阅
              </span>
              <Switch
                checked={formData.enabled}
                onChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
            </div>
            <div className='flex gap-2 justify-end pt-2'>
              <button
                onClick={resetForm}
                disabled={loading}
                className='px-4 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50'
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className='px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2'
              >
                {loading && <Loader2 size={16} className='animate-spin' />}
                {editingSubscription ? '更新' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 订阅列表 */}
      {subscriptions.length === 0 ? (
        <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
          暂无订阅，点击"添加订阅"开始追番
        </div>
      ) : (
        <div className='space-y-3'>
          {subscriptions.map((sub) => (
            <div
              key={sub.id}
              className='bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4'
            >
              {/* 桌面端布局 */}
              <div className='hidden md:flex items-start justify-between gap-4'>
                <div className='flex-1 space-y-2'>
                  <div className='flex items-center gap-3'>
                    <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
                      {sub.title}
                    </h3>
                    <span className='px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'>
                      {sub.source === 'acgrip' ? 'ACG.RIP' : sub.source === 'mikan' ? '蜜柑' : '动漫花园'}
                    </span>
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
                    <p>过滤条件：{sub.filterText}</p>
                    <p>当前集数：第 {sub.lastEpisode} 集</p>
                    <p>上次检查：{formatTime(sub.lastCheckTime)}</p>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <Switch
                    checked={sub.enabled}
                    onChange={() => handleToggleSubscription(sub)}
                    disabled={loading}
                  />
                  <button
                    onClick={() => handleCheckSubscription(sub.id)}
                    disabled={checkingId === sub.id}
                    className='p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50'
                    title='立即检查'
                  >
                    {checkingId === sub.id ? (
                      <Loader2 size={18} className='animate-spin' />
                    ) : (
                      <RefreshCw size={18} />
                    )}
                  </button>
                  <button
                    onClick={() => handleEdit(sub)}
                    disabled={loading}
                    className='p-2 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50'
                    title='编辑'
                  >
                    <svg className='w-[18px] h-[18px]' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(sub.id, sub.title)}
                    disabled={loading}
                    className='p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50'
                    title='删除'
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* 移动端布局 */}
              <div className='md:hidden space-y-3'>
                <div className='flex items-start justify-between gap-2'>
                  <div className='flex-1 min-w-0'>
                    <h3 className='text-base font-medium text-gray-900 dark:text-gray-100 truncate'>
                      {sub.title}
                    </h3>
                    <span className='inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'>
                      {sub.source === 'acgrip' ? 'ACG.RIP' : sub.source === 'mikan' ? '蜜柑' : '动漫花园'}
                    </span>
                  </div>
                  <Switch
                    checked={sub.enabled}
                    onChange={() => handleToggleSubscription(sub)}
                    disabled={loading}
                  />
                </div>
                <div className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
                  <p className='break-all'>过滤：{sub.filterText}</p>
                  <p>集数：第 {sub.lastEpisode} 集 · {formatTime(sub.lastCheckTime)}</p>
                </div>
                <div className='flex items-center gap-2 pt-1'>
                  <button
                    onClick={() => handleCheckSubscription(sub.id)}
                    disabled={checkingId === sub.id}
                    className='flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50'
                  >
                    {checkingId === sub.id ? (
                      <>
                        <Loader2 size={16} className='animate-spin' />
                        <span>检查中</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        <span>检查</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleEdit(sub)}
                    disabled={loading}
                    className='flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-green-600 bg-green-50 hover:bg-green-100 dark:text-green-400 dark:bg-green-900/20 dark:hover:bg-green-900/30 rounded-lg transition-colors disabled:opacity-50'
                  >
                    <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' />
                    </svg>
                    <span>编辑</span>
                  </button>
                  <button
                    onClick={() => handleDelete(sub.id, sub.title)}
                    disabled={loading}
                    className='flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50'
                  >
                    <Trash2 size={16} />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AlertModal */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
}
