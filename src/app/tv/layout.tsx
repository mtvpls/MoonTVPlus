import { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import TVRemoteReceiver from '@/components/tv/TVRemoteReceiver';
import { isTVModeEnabled } from '@/lib/tv-mode';

export const metadata = {
  title: 'TV - MoonTV Plus',
};

export default function Layout({ children }: { children: ReactNode }) {
  if (!isTVModeEnabled()) {
    notFound();
  }

  return (
    <>
      {children}
      <TVRemoteReceiver />
    </>
  );
}
