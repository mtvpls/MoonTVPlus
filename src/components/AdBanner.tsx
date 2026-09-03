'use client';

import { useEffect, useRef } from 'react';

/**
 * 广告贴片组件
 * 使用第三方广告联盟 (highrevenueformat.com) 的广告代码
 */
export default function AdBanner() {
  const adContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adContainerRef.current) return;

    // 设置广告参数
    (window as any).atOptions = {
      key: '04d237054276c646c0c70e5bfeba9d02',
      format: 'iframe',
      height: 600,
      width: 160,
      params: {},
    };

    // 创建并插入广告脚本
    const script = document.createElement('script');
    script.src =
      'https://www.highrevenueformat.com/04d237054276c646c0c70e5bfeba9d02/invoke.js';
    script.async = true;

    adContainerRef.current.innerHTML = '';
    adContainerRef.current.appendChild(script);

    return () => {
      if (adContainerRef.current) {
        adContainerRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div className='w-full flex justify-center my-4'>
      <div ref={adContainerRef} className='ad-banner-container' />
    </div>
  );
}
