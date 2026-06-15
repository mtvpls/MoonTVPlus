'use client';

import { CheckCircle, Loader2, LogIn, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

function QrLoginClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const authed = Boolean(getAuthInfoFromBrowserCookie());

  const confirm = async () => {
    setLoading(true);
    setMessage('');
    const res = await fetch('/api/auth/qr/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    setLoading(false);
    setMessage(res.ok ? '确认成功，请回到电视查看。' : data.error || '确认失败');
  };

  const cancel = async () => {
    await fetch('/api/auth/qr/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    setMessage('已取消本次电视登录。');
  };

  return (
    <main className='min-h-screen bg-black px-5 py-10 text-white'>
      <section className='mx-auto max-w-md rounded-[32px] border border-white/10 bg-slate-950 p-7 shadow-2xl shadow-black'>
        <h1 className='text-3xl font-black'>确认登录电视端</h1>
        <p className='mt-3 text-slate-300'>请确认电视屏幕上的二维码来自你正在使用的设备。</p>
        {!authed ? (
          <div className='mt-8 rounded-3xl bg-white/5 p-5'>
            <LogIn className='h-12 w-12 text-rose-400' />
            <p className='mt-4 text-lg font-bold'>当前手机未登录，请先登录后再确认电视登录。</p>
            <Link href={`/login?redirect=${encodeURIComponent(`/qr-login?token=${token}`)}`} className='mt-5 block rounded-2xl bg-rose-600 px-5 py-4 text-center text-lg font-black'>去登录</Link>
          </div>
        ) : (
          <div className='mt-8 grid gap-3'>
            <button onClick={confirm} disabled={loading || !token} className='flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 py-4 text-lg font-black disabled:opacity-60'>
              {loading ? <Loader2 className='h-5 w-5 animate-spin' /> : <CheckCircle className='h-5 w-5' />} 确认登录
            </button>
            <button onClick={cancel} className='flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-5 py-4 text-lg font-bold'>
              <XCircle className='h-5 w-5' /> 取消
            </button>
          </div>
        )}
        {message && <p className='mt-5 rounded-2xl bg-white/10 p-4 text-center text-lg font-bold'>{message}</p>}
      </section>
    </main>
  );
}

export default function QrLoginPage() {
  return <Suspense fallback={null}><QrLoginClient /></Suspense>;
}
