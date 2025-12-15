/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

'use client';

import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

// 按钮样式
const buttonStyles = {
  success:
    'px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-lg transition-colors',
  danger:
    'px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 text-white rounded-lg transition-colors',
  secondary:
    'px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 text-white rounded-lg transition-colors',
  roundedSuccess:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-200 transition-colors',
  roundedDanger:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-200 transition-colors',
  roundedPrimary:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors',
};

interface TvboxSubscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastUpdate?: string;
  lastError?: string;
  autoUpdate?: boolean;
}

interface TvboxSubscriptionConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

export default function TvboxSubscriptionConfig({
  config,
  refreshConfig,
}: TvboxSubscriptionConfigProps) {
  const [subscriptions, setSubscriptions] = useState<TvboxSubscription[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [newSubscription, setNewSubscription] = useState({
    name: '',
    url: '',
  });

  // 初始化订阅列表
  useEffect(() => {
    if (config?.TvboxSubscriptions) {
      setSubscriptions(config.TvboxSubscriptions);
    }
  }, [config]);

  // 调用API
  const callApi = async (body: Record<string, any>) => {
    const resp = await fetch('/api/admin/tvbox-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `操作失败: ${resp.status}`);
    }

    await refreshConfig();
  };

  // 添加订阅
  const handleAdd = async () => {
    if (!newSubscription.name.trim() || !newSubscription.url.trim()) {
      alert('请填写订阅名称和URL');
      return;
    }

    setIsLoading({ ...isLoading, add: true });
    try {
      await callApi({
        action: 'add',
        name: newSubscription.name,
        url: newSubscription.url,
      });
      setNewSubscription({ name: '', url: '' });
      setShowAddForm(false);
      alert('添加成功');
    } catch (error: any) {
      alert(`添加失败: ${error.message}`);
    } finally {
      setIsLoading({ ...isLoading, add: false });
    }
  };

  // 删除订阅
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除订阅"${name}"吗？此操作将同时删除来自该订阅的所有视频源。`)) {
      return;
    }

    setIsLoading({ ...isLoading, [`delete_${id}`]: true });
    try {
      await callApi({ action: 'delete', id });
      alert('删除成功');
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    } finally {
      setIsLoading({ ...isLoading, [`delete_${id}`]: false });
    }
  };

  // 刷新订阅
  const handleRefresh = async (id: string, name: string) => {
    setIsLoading({ ...isLoading, [`refresh_${id}`]: true });
    try {
      await callApi({ action: 'refresh', id });
      alert(`订阅"${name}"已刷新`);
    } catch (error: any) {
      alert(`刷新失败: ${error.message}`);
    } finally {
      setIsLoading({ ...isLoading, [`refresh_${id}`]: false });
    }
  };

  // 切换启用/禁用
  const handleToggle = async (id: string, currentEnabled: boolean) => {
    const action = currentEnabled ? 'disable' : 'enable';
    setIsLoading({ ...isLoading, [`toggle_${id}`]: true });
    try {
      await callApi({ action, id });
    } catch (error: any) {
      alert(`操作失败: ${error.message}`);
    } finally {
      setIsLoading({ ...isLoading, [`toggle_${id}`]: false });
    }
  };

  // 获取来自订阅的视频源数量
  const getSourceCount = (subscriptionId: string) => {
    return config?.SourceConfig?.filter(s => s.subscriptionId === subscriptionId).length || 0;
  };

  return (
    <div className='space-y-6'>
      {/* 添加订阅表单 */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          TVBOX 订阅列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={showAddForm ? buttonStyles.secondary : buttonStyles.success}
        >
          {showAddForm ? '取消' : '添加订阅'}
        </button>
      </div>

      {showAddForm && (
        <div className='bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              订阅名称
            </label>
            <input
              type='text'
              value={newSubscription.name}
              onChange={(e) =>
                setNewSubscription({ ...newSubscription, name: e.target.value })
              }
              placeholder='例如：我的订阅'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              订阅URL
            </label>
            <input
              type='url'
              value={newSubscription.url}
              onChange={(e) =>
                setNewSubscription({ ...newSubscription, url: e.target.value })
              }
              placeholder='https://example.com/tvbox.json'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end gap-2'>
            <button
              onClick={() => setShowAddForm(false)}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={isLoading.add}
              className={buttonStyles.success}
            >
              {isLoading.add ? '添加中...' : '确认添加'}
            </button>
          </div>
        </div>
      )}

      {/* 订阅列表 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden'>
        {subscriptions.length === 0 ? (
          <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
            暂无订阅，点击上方按钮添加TVBOX订阅
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
              <thead className='bg-gray-50 dark:bg-gray-800'>
                <tr>
                  <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    订阅名称
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    订阅URL
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    视频源数量
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    状态
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    最后更新
                  </th>
                  <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className='bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700'>
                {subscriptions.map((sub) => (
                  <tr key={sub.id}>
                    <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {sub.name}
                    </td>
                    <td className='px-6 py-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate'>
                      <a
                        href={sub.url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='hover:text-blue-600 dark:hover:text-blue-400'
                      >
                        {sub.url}
                      </a>
                    </td>
                    <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                      {getSourceCount(sub.id)} 个
                    </td>
                    <td className='px-6 py-4 whitespace-nowrap'>
                      <div className='flex flex-col gap-1'>
                        <span
                          className={`px-2 py-1 text-xs rounded-full inline-block w-fit ${
                            sub.enabled
                              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                          }`}
                        >
                          {sub.enabled ? '启用中' : '已禁用'}
                        </span>
                        {sub.lastError && (
                          <span
                            className='px-2 py-1 text-xs rounded-full bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 inline-block w-fit'
                            title={sub.lastError}
                          >
                            更新失败
                          </span>
                        )}
                      </div>
                    </td>
                    <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400'>
                      {sub.lastUpdate
                        ? new Date(sub.lastUpdate).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '从未更新'}
                    </td>
                    <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                      <button
                        onClick={() => handleRefresh(sub.id, sub.name)}
                        disabled={isLoading[`refresh_${sub.id}`]}
                        className={buttonStyles.roundedPrimary}
                        title='刷新订阅'
                      >
                        <RefreshCw
                          size={14}
                          className={isLoading[`refresh_${sub.id}`] ? 'animate-spin' : ''}
                        />
                      </button>
                      <button
                        onClick={() => handleToggle(sub.id, sub.enabled)}
                        disabled={isLoading[`toggle_${sub.id}`]}
                        className={
                          sub.enabled
                            ? buttonStyles.roundedDanger
                            : buttonStyles.roundedSuccess
                        }
                      >
                        {sub.enabled ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => handleDelete(sub.id, sub.name)}
                        disabled={isLoading[`delete_${sub.id}`]}
                        className={buttonStyles.roundedDanger}
                        title='删除订阅'
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 说明 */}
      <div className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
        <p>• TVBOX订阅格式支持标准的TVBOX JSON配置文件</p>
        <p>• 只会导入其中type=1的苹果CMS格式视频源</p>
        <p>• 刷新订阅会重新获取最新的视频源列表</p>
        <p>• 禁用订阅会同时禁用所有来自该订阅的视频源</p>
        <p>• 删除订阅会同时删除所有来自该订阅的视频源</p>
      </div>
    </div>
  );
}
