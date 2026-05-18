'use client';

import { BookOpen, CircleMinus, CirclePlus, Info, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useLongPress } from '@/hooks/useLongPress';
import { MangaReadRecord } from '@/lib/manga.types';
import { processImageUrl } from '@/lib/utils';

import ImageViewer from '@/components/ImageViewer';
import MobileActionSheet from '@/components/MobileActionSheet';
import ProxyImage from '@/components/ProxyImage';

interface MangaHistoryCardProps {
  item: MangaReadRecord;
  inShelf: boolean;
  onToggleShelf: (item: MangaReadRecord) => void | Promise<void>;
  onDelete: (item: MangaReadRecord) => void | Promise<void>;
}

export default function MangaHistoryCard({ item, inShelf, onToggleShelf, onDelete }: MangaHistoryCardProps) {
  const router = useRouter();
  const [showActions, setShowActions] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);

  const readHref = useMemo(
    () => `/manga/read?mangaId=${item.mangaId}&sourceId=${item.sourceId}&chapterId=${item.chapterId}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&chapterName=${encodeURIComponent(item.chapterName)}&returnTo=${encodeURIComponent('/manga/history')}`,
    [item]
  );

  const detailHref = useMemo(
    () => `/manga/detail?mangaId=${item.mangaId}&sourceId=${item.sourceId}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&returnTo=${encodeURIComponent('/manga/history')}`,
    [item]
  );

  const subtitle = useMemo(
    () => `${item.chapterName} · 第 ${item.pageIndex + 1}/${item.pageCount} 页`,
    [item]
  );

  const openActions = () => setShowActions(true);
  const goRead = () => router.push(readHref);

  const longPressProps = useLongPress({
    onLongPress: openActions,
    onClick: goRead,
    longPressDelay: 500,
  });

  const actions = useMemo(
    () => [
      {
        id: 'continue-reading',
        label: '继续阅读',
        icon: <BookOpen size={20} />,
        onClick: goRead,
        color: 'primary' as const,
      },
      {
        id: 'detail',
        label: '详情',
        icon: <Info size={20} />,
        onClick: () => router.push(detailHref),
      },
      {
        id: 'toggle-shelf',
        label: inShelf ? '移除书架' : '加入书架',
        icon: inShelf ? <CircleMinus size={20} /> : <CirclePlus size={20} />,
        onClick: () => onToggleShelf(item),
        color: inShelf ? ('danger' as const) : ('default' as const),
      },
      {
        id: 'delete',
        label: '删除',
        icon: <Trash2 size={20} />,
        onClick: () => onDelete(item),
        color: 'danger' as const,
      },
    ],
    [detailHref, goRead, inShelf, item, onDelete, onToggleShelf, router]
  );

  return (
    <>
      <div
        className='group overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-gray-700 dark:bg-gray-900/80 cursor-pointer'
        onClick={goRead}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openActions();
        }}
        onDragStart={(e) => {
          e.preventDefault();
        }}
        {...longPressProps}
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
      >
        <div
          className='relative aspect-[3/4] overflow-hidden bg-gray-100 dark:bg-gray-800'
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        >
          {item.cover ? (
            <ProxyImage
              originalSrc={item.cover}
              alt={item.title}
              className='h-full w-full object-cover transition duration-300 group-hover:scale-105 pointer-events-none'
              draggable={false}
            />
          ) : (
            <div className='flex h-full items-center justify-center text-sm text-gray-400'>暂无封面</div>
          )}
        </div>
        <div className='space-y-1 p-3'>
          <div className='line-clamp-2 min-h-[2.75rem] text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {item.title}
          </div>
          <div className='text-xs text-gray-500 dark:text-gray-400'>{item.sourceName}</div>
          <div className='line-clamp-2 text-xs text-sky-600 dark:text-sky-400'>{subtitle}</div>
        </div>
      </div>

      <MobileActionSheet
        isOpen={showActions}
        onClose={() => setShowActions(false)}
        title={item.title}
        poster={processImageUrl(item.cover)}
        sourceName={item.sourceName}
        actions={actions}
        onPosterClick={() => setShowImageViewer(true)}
      />

      {showImageViewer && (
        <ImageViewer
          isOpen={showImageViewer}
          onClose={() => setShowImageViewer(false)}
          imageUrl={item.cover}
          alt={item.title}
        />
      )}
    </>
  );
}
