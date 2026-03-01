/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Bell, Check, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { Notification } from '@/lib/types';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载通知
  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/notifications');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('加载通知失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 标记为已读
  const markAsRead = async (notificationId: string) => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_read',
          notificationId,
        }),
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, read: true } : n
          )
        );
        // 触发事件通知 UserMenu 更新未读计数
        window.dispatchEvent(new Event('notificationsUpdated'));
      }
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  };

  // 删除通知
  const deleteNotification = async (notificationId: string) => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          notificationId,
        }),
      });

      if (response.ok) {
        const deletedNotification = notifications.find((n) => n.id === notificationId);
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
        // 如果删除的是未读通知，触发事件更新 UserMenu
        if (deletedNotification && !deletedNotification.read) {
          window.dispatchEvent(new Event('notificationsUpdated'));
        }
      }
    } catch (error) {
      console.error('删除通知失败:', error);
    }
  };

  // 清空所有通知
  const clearAll = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear_all',
        }),
      });

      if (response.ok) {
        setNotifications([]);
        // 触发事件通知 UserMenu 更新未读计数
        window.dispatchEvent(new Event('notificationsUpdated'));
      }
    } catch (error) {
      console.error('清空通知失败:', error);
    }
  };

  // 处理通知点击
  const handleNotificationClick = (notification: Notification) => {
    // 标记为已读
    if (!notification.read) {
      markAsRead(notification.id);
    }

    // 根据通知类型跳转
    if (notification.type === 'favorite_update' && notification.metadata) {
      const { source, id, title } = notification.metadata;
      router.push(`/play?source=${source}&id=${id}&title=${encodeURIComponent(title)}`);
      onClose();
    } else if (notification.type === 'movie_request') {
      // 获取用户角色
      const authInfo = getAuthInfoFromBrowserCookie();
      const isAdmin = authInfo?.role === 'owner' || authInfo?.role === 'admin';

      // 管理员跳转到管理面板，普通用户跳转到我的求片
      router.push(isAdmin ? '/admin' : '/movie-request');
      onClose();
    }
  };

  // 打开面板时加载通知
  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
      />

      {/* 通知面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[80vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col overflow-hidden'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-2'>
            <Bell className='w-5 h-5 text-gray-600 dark:text-gray-400' />
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200'>
              通知中心
            </h3>
            {notifications.length > 0 && (
              <span className='px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full'>
                {notifications.filter((n) => !n.read).length} 条未读
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className='text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors'
              >
                清空全部
              </button>
            )}
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>
        </div>

        {/* 通知列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <div className='w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin'></div>
            </div>
          ) : notifications.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400'>
              <Bell className='w-12 h-12 mb-3 opacity-30' />
              <p className='text-sm'>暂无通知</p>
            </div>
          ) : (
            <div className='space-y-2'>
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`group relative p-4 rounded-lg border transition-all cursor-pointer ${
                    notification.read
                      ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                      : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  } hover:shadow-md`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  {/* 未读标识 */}
                  {!notification.read && (
                    <div className='absolute top-4 right-4 w-2 h-2 bg-green-500 rounded-full'></div>
                  )}

                  {/* 通知内容 */}
                  <div className='pr-8'>
                    <div className='flex items-start justify-between mb-1'>
                      <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                        {notification.title}
                      </h4>
                    </div>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-2'>
                      {notification.message}
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-500'>
                      {new Date(notification.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>

                  {/* 操作按钮 */}
                  <div className='absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                    {!notification.read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(notification.id);
                        }}
                        className='p-1.5 rounded-full bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors'
                        title='标记为已读'
                      >
                        <Check className='w-3.5 h-3.5 text-green-600 dark:text-green-400' />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(notification.id);
                      }}
                      className='p-1.5 rounded-full bg-white dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors'
                      title='删除'
                    >
                      <Trash2 className='w-3.5 h-3.5 text-red-600 dark:text-red-400' />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
