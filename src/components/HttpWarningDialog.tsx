'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

interface HttpWarningDialogProps {
  onClose: () => void;
}

export default function HttpWarningDialog({ onClose }: HttpWarningDialogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    // 检查是否应该显示弹窗
    const checkShouldShow = () => {
      // 只在客户端执行
      if (typeof window === 'undefined') return false;

      // 检查是否已经选择不再提示
      const dontShowAgain = localStorage.getItem('httpWarningDismissed');
      if (dontShowAgain === 'true') return false;

      // 检查是否是站长
      const authInfo = getAuthInfoFromBrowserCookie();
      if (!authInfo || authInfo.role !== 'owner') return false;

      // 检查是否是 HTTP 环境（非 localhost 和 127.0.0.1）
      const { protocol, hostname } = window.location;
      const isHttp = protocol === 'http:';
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

      // 只在 HTTP 且非本地环境下显示
      return isHttp && !isLocalhost;
    };

    const shouldDisplay = checkShouldShow();
    setShouldShow(shouldDisplay);

    if (shouldDisplay) {
      // 延迟显示动画
      setTimeout(() => setIsVisible(true), 100);
    }
  }, []);

  const handleDontShowAgain = () => {
    localStorage.setItem('httpWarningDismissed', 'true');
    handleClose();
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // 如果不需要显示，直接返回 null
  if (!shouldShow) return null;

  return createPortal(
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-yellow-200 dark:border-yellow-800 transition-all duration-300 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* 图标和标题 */}
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0">
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                HTTP 环境功能限制提示
              </h3>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <p>
                  检测到您正在使用 HTTP 协议访问本站。由于浏览器安全策略限制，以下功能将无法正常使用:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>视频超分（AI 画质增强）</li>
                  <li>麦克风语音功能</li>
                  <li>其他需要安全上下文的高级功能</li>
                </ul>
                <p className="mt-3 text-yellow-600 dark:text-yellow-500 font-medium">
                  建议配置 HTTPS 证书以获得完整功能体验。
                </p>
              </div>
            </div>
          </div>

          {/* 按钮组 */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={handleDontShowAgain}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              不再提示
            </button>
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
