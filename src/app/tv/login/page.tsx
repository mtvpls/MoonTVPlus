'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import TVLayout from '@/components/tv/TVLayout';

type QrState = { token: string; qrUrl: string; expiresAt: number; ttl: number };

export default function TVLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/tv';
  const [qr, setQr] = useState<QrState | null>(null);
  const [status, setStatus] = useState('正在生成二维码');
  const [left, setLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const creatingRef = useRef(false);

  const create = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    setQr(null);
    setError('');
    setStatus('正在生成二维码');
    try {
      const res = await fetch('/api/auth/qr/create', { method: 'POST' });
      if (!res.ok) throw new Error('二维码生成失败，请重试');
      const data = await res.json();
      if (!data.token || !data.expiresAt)
        throw new Error('二维码生成失败，请重试');
      const qrUrl = `${
        window.location.origin
      }/qr-login?token=${encodeURIComponent(data.token)}`;
      setQr({ ...data, qrUrl });
      setLeft(Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000)));
      setStatus('请使用手机扫码登录');
    } catch {
      setError('二维码生成失败，请检查连接后重试');
      setStatus('');
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    create();
  }, [create]);

  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((qr.expiresAt - Date.now()) / 1000)
      );
      setLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        create();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [create, qr]);

  useEffect(() => {
    if (!qr) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/auth/qr/status?token=${encodeURIComponent(qr.token)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error('状态查询失败');
        const data = await res.json();
        if (!alive) return;
        if (data.status === 'pending') setStatus('请使用手机扫码登录');
        if (data.status === 'scanned') setStatus('已扫码，请在手机上确认');
        if (data.status === 'confirmed') {
          setStatus('登录成功，正在进入电视端');
          window.clearInterval(timer);
          router.replace(redirect);
        }
        if (data.status === 'expired') setStatus('二维码已过期，请刷新');
        if (data.status === 'cancelled') setStatus('已取消，请刷新二维码');
      } catch {
        if (alive) setStatus('连接暂时中断，正在重试');
      }
    }, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [qr, redirect, router]);

  const qrImg = qr
    ? `/api/auth/qr/image?data=${encodeURIComponent(qr.qrUrl)}`
    : '';

  return (
    <TVLayout showNav={false}>
      <section className='mx-auto grid min-h-[560px] max-w-[1440px] items-center gap-8 rounded-2xl border border-white/[0.08] bg-[#19191b] p-6 md:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:p-12'>
        <div className='min-w-0'>
          <p className='text-lg text-[#a1a1a6]'>手机确认 · 电视登录</p>
          <h1 className='mt-4 text-4xl font-medium leading-tight lg:text-5xl'>
            扫码登录
          </h1>
          <p className='mt-6 max-w-2xl text-xl leading-8 text-[#a1a1a6] lg:text-2xl lg:leading-10'>
            用已登录的手机浏览器扫描二维码，在手机上确认后，电视会自动进入
          </p>
          <p
            aria-live='polite'
            role={error ? 'alert' : 'status'}
            className={`mt-6 min-h-7 text-xl ${
              error ? 'text-rose-200' : 'text-[#ededed]'
            }`}
          >
            {error || status}
          </p>
          <button
            type='button'
            onClick={create}
            disabled={loading}
            className='tv-focusable mt-6 inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#ededed] px-5 py-3 text-xl font-medium text-[#141415] outline-none hover:bg-white disabled:cursor-not-allowed disabled:opacity-60'
          >
            <RefreshCw
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
            {error ? '重试' : '刷新二维码'}
          </button>
        </div>
        <div className='w-full max-w-80 justify-self-center rounded-2xl bg-white p-4 text-center text-[#141415]'>
          {qrImg ? (
            <img
              src={qrImg}
              alt='扫码登录二维码'
              className='aspect-square w-full'
              draggable={false}
            />
          ) : (
            <div className='flex aspect-square items-center justify-center px-4 text-lg text-[#525257]'>
              {loading ? (
                <Loader2
                  className='h-[18px] w-[18px] animate-spin motion-reduce:animate-none'
                  strokeWidth={1.5}
                  aria-label='正在生成二维码'
                />
              ) : (
                '暂时无法生成二维码'
              )}
            </div>
          )}
          <p className='mt-4 text-lg tabular-nums'>
            {qr ? `剩余 ${left} 秒` : '手机扫码确认登录'}
          </p>
        </div>
      </section>
    </TVLayout>
  );
}
