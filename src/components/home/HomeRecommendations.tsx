'use client';

import { Flame, Play, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import styles from './HomeDashboard.module.css';

import { DoubanItem } from '@/lib/types';

import ProxyImage from '@/components/ProxyImage';

interface HomeRecommendationsProps {
  items: DoubanItem[];
  loading: boolean;
}

export default function HomeRecommendations({
  items,
  loading,
}: HomeRecommendationsProps) {
  const [batch, setBatch] = useState(0);
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.title}-${item.year}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [items]);
  const batchCount = Math.max(1, Math.ceil(uniqueItems.length / 6));
  const currentBatch = batch % batchCount;
  const visibleItems = Array.from(
    { length: Math.min(6, uniqueItems.length) },
    (_, index) => uniqueItems[(currentBatch * 6 + index) % uniqueItems.length]
  );

  return (
    <section
      className={styles.featured}
      aria-labelledby='home-movies-title'
      aria-busy={loading}
    >
      <div className={styles.featuredHeader}>
        <div className={styles.featuredHeading}>
          <h2 id='home-movies-title' className={styles.panelTitle}>
            <Flame aria-hidden='true' />
            精选推荐
          </h2>
          <p>为你推荐更多精彩内容</p>
        </div>
        <button
          type='button'
          className={styles.refresh}
          onClick={() => setBatch((value) => (value + 1) % batchCount)}
          disabled={loading || batchCount < 2}
          aria-label='换一批精选推荐'
        >
          <RefreshCw aria-hidden='true' />
          换一批
        </button>
      </div>
      {loading ? (
        <div
          className={styles.featuredGrid}
          role='status'
          aria-label='正在加载精选推荐'
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} aria-hidden='true'>
              <div className={`${styles.filmImage} ${styles.skeleton}`} />
              <div className={`${styles.skeletonText} ${styles.skeleton}`} />
            </div>
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className={styles.emptyHistory}>
          <p>暂时没有推荐内容，稍后再来看看。</p>
          <Link href='/douban?type=movie'>浏览电影片库</Link>
        </div>
      ) : (
        <div className={styles.featuredGrid}>
          {visibleItems.map((item) => {
            const params = new URLSearchParams({
              title: item.title,
              stype: 'movie',
            });
            if (item.year) params.set('year', item.year);
            const rating = Number(item.rate);
            return (
              <Link
                key={`${item.id}-${item.title}`}
                href={`/play?${params}`}
                prefetch={false}
                className={styles.film}
                aria-label={`播放${item.title}`}
              >
                <div className={styles.filmImage}>
                  {item.poster && (
                    <ProxyImage originalSrc={item.poster} alt='' />
                  )}
                  <span className={styles.filmPlay}>
                    <Play aria-hidden='true' />
                  </span>
                  {Number.isFinite(rating) && rating > 0 && (
                    <span className={styles.filmBadge}>
                      评分 {rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <span className={styles.filmName} title={item.title}>
                  {item.title}
                </span>
                <span className={styles.filmMeta}>
                  {['电影', item.year].filter(Boolean).join(' · ')}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
