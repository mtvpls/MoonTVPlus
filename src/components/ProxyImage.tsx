'use client';

import React from 'react';

import { processImageUrl, tryApplyDoubanImageFallback } from '@/lib/utils';

interface ProxyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  originalSrc: string;
  displaySrc?: string;
  retryDelay?: number;
  retryOnError?: boolean;
}

const ProxyImage: React.FC<ProxyImageProps> = ({
  originalSrc,
  displaySrc,
  retryDelay = 2000,
  retryOnError = true,
  loading = 'lazy',
  decoding = 'async',
  onError,
  src: _src,
  ...props
}) => {
  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const img = e.currentTarget;

    if (tryApplyDoubanImageFallback(img, originalSrc)) {
      return;
    }

    if (retryOnError && !img.dataset.retried) {
      img.dataset.retried = 'true';
      window.setTimeout(() => {
        img.src = displaySrc || processImageUrl(originalSrc);
      }, retryDelay);
    }

    onError?.(e);
  };

  return (
    <img
      {...props}
      src={displaySrc || processImageUrl(originalSrc)}
      loading={loading}
      decoding={decoding}
      onError={handleError}
    />
  );
};

export default ProxyImage;
