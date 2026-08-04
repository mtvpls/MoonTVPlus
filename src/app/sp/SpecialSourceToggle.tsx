'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

/**
 * /sp 页面的特殊源入口开关。
 * 管理员可以直接在这里开关（PUT /api/admin/special-sources/toggle），
 * 普通用户只看到当前状态，开关不可点。
 */
export default function SpecialSourceToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 服务端刷新后同步真实状态
  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    const role = getAuthInfoFromBrowserCookie()?.role;
    setIsAdmin(role === 'admin' || role === 'owner');
  }, []);

  const handleToggle = async () => {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    setError('');
    setEnabled(next);
    try {
      const res = await fetch('/api/admin/special-sources/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '切换失败');
      }
      // 页面是 force-dynamic，刷新后状态文案与 /r18 入口按钮一起更新
      router.refresh();
    } catch (e) {
      setEnabled(!next);
      setError(e instanceof Error ? e.message : '切换失败');
    } finally {
      setSaving(false);
    }
  };

  const track = `relative inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors ${
    enabled ? 'bg-rose-600' : 'bg-gray-300 dark:bg-slate-700'
  }`;
  const thumb = `h-6 w-6 rounded-full bg-white transition-transform ${
    enabled ? 'translate-x-6' : 'translate-x-0'
  }`;
  const label = enabled ? '特殊源入口已开启' : '特殊源入口已关闭';

  return (
    <div className='flex flex-col items-end gap-1'>
      {isAdmin ? (
        <button
          type='button'
          onClick={handleToggle}
          disabled={saving}
          role='switch'
          aria-checked={enabled}
          aria-label={label}
          title='点击切换特殊源入口'
          className={`${track} focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 disabled:opacity-60`}
        >
          <span className={thumb} />
        </button>
      ) : (
        <span className={track} role='img' aria-label={label}>
          <span className={thumb} />
        </span>
      )}
      {error && (
        <span className='text-xs text-rose-500' role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}
