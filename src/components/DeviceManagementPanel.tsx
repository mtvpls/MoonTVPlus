'use client';

import { LucideIcon, Monitor, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface DeviceItem {
  tokenId: string;
  deviceInfo: string;
  isCurrent: boolean;
  createdAt: string;
  lastUsed: string;
}

interface DeviceManagementPanelProps {
  isOpen: boolean;
  mounted: boolean;
  onClose: () => void;
  devices: DeviceItem[];
  devicesLoading: boolean;
  revoking: string | null;
  onRevokeDevice: (tokenId: string) => void;
  onRevokeAllDevices: () => void;
  getDeviceIcon: (deviceInfo: string) => LucideIcon;
}

export function DeviceManagementPanel({
  isOpen,
  mounted,
  onClose,
  devices,
  devicesLoading,
  revoking,
  onRevokeDevice,
  onRevokeAllDevices,
  getDeviceIcon,
}: DeviceManagementPanelProps) {
  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
        onTouchMove={(e) => e.preventDefault()}
        onWheel={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'>
        <div
          className='h-full max-h-[80vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => e.stopPropagation()}
          style={{ touchAction: 'auto' }}
        >
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              设备管理
            </h3>
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          <div className='flex-1 overflow-y-auto p-6'>
            {devicesLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div key={i} className='animate-pulse'>
                    <div className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg'></div>
                  </div>
                ))}
                <div className='text-center text-sm text-gray-500 dark:text-gray-400 mt-4'>
                  加载中...
                </div>
              </div>
            ) : devices.length === 0 ? (
              <div className='text-center py-8'>
                <Monitor className='w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3' />
                <p className='text-sm text-gray-500 dark:text-gray-400'>暂无登录设备</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {devices
                  .slice()
                  .sort((a, b) => {
                    if (a.isCurrent && !b.isCurrent) return -1;
                    if (!a.isCurrent && b.isCurrent) return 1;
                    return 0;
                  })
                  .map((device) => {
                    const DeviceIcon = getDeviceIcon(device.deviceInfo);
                    return (
                      <div
                        key={device.tokenId}
                        className={`p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border ${
                          device.isCurrent
                            ? 'border-yellow-400 dark:border-yellow-500'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className='flex items-start justify-between'>
                          <div className='flex-1'>
                            <div className='flex items-center gap-2 mb-2'>
                              <DeviceIcon className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                              <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                                {device.deviceInfo}
                              </span>
                              {device.isCurrent && (
                                <span className='px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full'>
                                  当前设备
                                </span>
                              )}
                            </div>
                            <div className='space-y-1 text-xs text-gray-500 dark:text-gray-400'>
                              <div>登录时间: {new Date(device.createdAt).toLocaleString('zh-CN')}</div>
                              <div>最后活跃: {new Date(device.lastUsed).toLocaleString('zh-CN')}</div>
                            </div>
                          </div>
                          {!device.isCurrent && (
                            <button
                              onClick={() => onRevokeDevice(device.tokenId)}
                              disabled={revoking === device.tokenId}
                              className='ml-3 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                            >
                              {revoking === device.tokenId ? '撤销中...' : '撤销'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className='p-6 border-t border-gray-200 dark:border-gray-700 space-y-3'>
            <button
              onClick={onRevokeAllDevices}
              disabled={devices.length === 0}
              className='w-full px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-red-400 dark:bg-red-600 dark:hover:bg-red-700 dark:disabled:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed'
            >
              登出所有设备
            </button>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              登出所有设备后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
