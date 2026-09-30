'use client';

import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useRef } from 'react';

import { resolveLoginPath } from '@/lib/tv-mode';

import HomeSkeleton from './HomeSkeleton';

export function isPublicAuthPath(pathname: string): boolean {
  return /^(\/(login|register|oidc-register|qr-login|warning|tv\/login)(\/|$)|\/tvbox(\/|$))/.test(
    pathname
  );
}

/**
 * Legacy registration / TV login may use router.replace after signing in.
 * Root layouts persist across client navigation. Reload once at this boundary
 * so the server can verify the new cookie and build the authenticated layout,
 * without mounting business children under the public layout in the meantime.
 */
export default function PublicAuthBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isPublicPage = isPublicAuthPath(pathname);
  const wasPublicPage = useRef(isPublicPage);

  useEffect(() => {
    if (isPublicPage) {
      wasPublicPage.current = true;
      return;
    }
    if (wasPublicPage.current) {
      // A client-side login just left a public page: rebuild the root layout once.
      wasPublicPage.current = false;
      window.location.replace(window.location.href);
      return;
    }
    // A fresh server render still rejected the session. Repeating the same URL
    // would loop forever if middleware and layout session state disagree.
    const redirect =
      window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(
      `${resolveLoginPath(pathname)}?redirect=${encodeURIComponent(redirect)}`
    );
  }, [isPublicPage, pathname]);

  if (!isPublicPage) {
    return (
      <div className='relative min-h-screen'>
        <HomeSkeleton />
        <p
          role='status'
          className='relative z-10 flex min-h-screen items-center justify-center'
        >
          正在验证登录状态…
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
