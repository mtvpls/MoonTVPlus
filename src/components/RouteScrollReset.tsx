'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export default function RouteScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined' || !pathname?.startsWith('/manga') || pathname === '/manga/read') return;

    const reset = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    reset();
    const rafId = window.requestAnimationFrame(reset);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [pathname]);

  return null;
}
