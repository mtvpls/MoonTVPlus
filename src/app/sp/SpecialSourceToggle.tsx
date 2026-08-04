'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { setSpecialSourceEnabledOnDevice } from '@/lib/special-source.client';

/**
 * /sp 页面的特殊源入口开关。
 * 本机开关：只写 cookie，任何人都能自行切换，只对自己这台设备/浏览器生效。
 */
export default function SpecialSourceToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);

  // 页面是 force-dynamic，服务端读到的 cookie 才是真相
  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const handleToggle = () => {
    const next = !enabled;
    setSpecialSourceEnabledOnDevice(next);
    setEnabled(next);
    // 刷新后状态文案与「前往里世界」按钮一起更新
    router.refresh();
  };

  const track = `relative inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors ${
    enabled ? 'bg-rose-600' : 'bg-gray-300 dark:bg-slate-700'
  }`;
  const thumb = `h-6 w-6 rounded-full bg-white transition-transform ${
    enabled ? 'translate-x-6' : 'translate-x-0'
  }`;

  return (
    <button
      type='button'
      onClick={handleToggle}
      role='switch'
      aria-checked={enabled}
      aria-label={enabled ? '特殊源入口已开启' : '特殊源入口已关闭'}
      title='点击切换本机的特殊源入口'
      className={`${track} focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2`}
    >
      <span className={thumb} />
    </button>
  );
}
