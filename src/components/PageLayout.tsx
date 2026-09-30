'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import DesktopNavbar from './DesktopNavbar';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import { VersionCheckProvider } from './VersionCheckProvider';

const DirectPlayDialog = dynamic(() => import('./DirectPlayDialog'), {
  ssr: false,
});

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  hideNavigation?: boolean; // 控制是否隐藏顶部和底部导航栏
}

const PageLayout = ({
  children,
  activePath = '/',
  hideNavigation = false,
}: PageLayoutProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const [directPlayOpen, setDirectPlayOpen] = useState(false);
  const openDirectPlay = useCallback(() => setDirectPlayOpen(true), []);
  const closeDirectPlay = useCallback(() => setDirectPlayOpen(false), []);
  const [backgroundImage, setBackgroundImage] = useState('');

  useEffect(() => {
    closeDirectPlay();
  }, [pathname, closeDirectPlay]);
  const shouldShowSharedBackground = !hideNavigation && activePath !== '/play';

  useEffect(() => {
    router.prefetch('/search');
    router.prefetch('/play');
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined' || !shouldShowSharedBackground) {
      setBackgroundImage('');
      return;
    }

    const homeBg = (
      window as Window & {
        RUNTIME_CONFIG?: {
          HOME_BACKGROUND_IMAGE?: string;
        };
      }
    ).RUNTIME_CONFIG?.HOME_BACKGROUND_IMAGE;
    if (!homeBg) {
      setBackgroundImage('');
      return;
    }

    const urls = homeBg
      .split('\n')
      .map((url: string) => url.trim())
      .filter((url: string) => url !== '');

    if (urls.length === 0) {
      setBackgroundImage('');
      return;
    }

    const randomIndex = Math.floor(Math.random() * urls.length);
    setBackgroundImage(urls[randomIndex]);
  }, [shouldShowSharedBackground]);

  const navigationOffsetClass = hideNavigation
    ? ''
    : 'mt-[calc(3rem+env(safe-area-inset-top))] md:mt-16';

  return (
    <VersionCheckProvider>
      <div className='relative min-h-screen w-full overflow-hidden'>
        {shouldShowSharedBackground && backgroundImage && (
          <>
            <div
              className='pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-45'
              style={{ backgroundImage: `url(${backgroundImage})` }}
            />
            <div className='pointer-events-none absolute inset-0 bg-white/50 dark:bg-gray-950/50' />
          </>
        )}

        {!hideNavigation && (
          <>
            <MobileHeader
              showBackButton={['/play', '/live'].includes(activePath)}
            />
            <DesktopNavbar
              onDirectPlay={openDirectPlay}
              activePath={activePath}
              showBackButton={['/play', '/live'].includes(activePath)}
            />
          </>
        )}

        <div className='relative z-10 flex min-h-screen w-full'>
          <div className='relative min-w-0 flex-1'>
            <main
              className={`flex-1 md:min-h-0 mb-14 md:mb-0 ${navigationOffsetClass}`}
              style={{
                paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
              }}
            >
              {children}
            </main>
          </div>
        </div>

        {!hideNavigation && (
          <div className='md:hidden'>
            <MobileBottomNav
              activePath={activePath}
              onDirectPlay={openDirectPlay}
            />
          </div>
        )}
      </div>
      {!hideNavigation && directPlayOpen && (
        <DirectPlayDialog onClose={closeDirectPlay} />
      )}
    </VersionCheckProvider>
  );
};

export default PageLayout;
