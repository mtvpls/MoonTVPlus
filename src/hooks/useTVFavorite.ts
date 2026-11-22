'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { deleteFavorite, isFavorited, saveFavorite } from '@/lib/db.client';
import type { Favorite } from '@/lib/types';

type TVFavoriteState = {
  key: string;
  source: string;
  id: string;
  optimistic: boolean;
  confirmed: boolean;
  version: number;
  queue: Promise<void>;
};

export function useTVFavorite(
  source: string | null | undefined,
  id: string | null | undefined
) {
  const key = source && id ? JSON.stringify([source, id]) : '';
  const [state, setState] = useState({ key: '', value: false });
  const statesRef = useRef(new Map<string, TVFavoriteState>());
  const currentRef = useRef<TVFavoriteState | null>(null);

  const publish = useCallback((favorite: TVFavoriteState) => {
    if (currentRef.current === favorite) {
      setState({ key: favorite.key, value: favorite.optimistic });
    }
  }, []);

  useEffect(() => {
    if (!source || !id) {
      currentRef.current = null;
      return;
    }

    let favorite = statesRef.current.get(key);
    if (!favorite) {
      favorite = {
        key,
        source,
        id,
        optimistic: false,
        confirmed: false,
        version: 0,
        queue: Promise.resolve(),
      };
      statesRef.current.set(key, favorite);
    }
    const current = favorite;
    currentRef.current = current;
    publish(current);
    const version = current.version;
    current.queue = current.queue
      .then(async () => {
        current.confirmed = await isFavorited(source, id);
        // 初始读取晚于点击完成时，保留用户刚刚选择的状态。
        if (current.version === version) {
          current.optimistic = current.confirmed;
          publish(current);
        }
      })
      .catch(() => undefined);

    return () => {
      if (currentRef.current === current) currentRef.current = null;
    };
  }, [id, key, publish, source]);

  const toggleFavorite = useCallback(
    (data: Favorite) => {
      const current = currentRef.current;
      if (!current || current.key !== key) return;
      const next = !current.optimistic;
      const version = ++current.version;
      current.optimistic = next;
      publish(current);

      // 每个影片/频道按点击顺序保存，按钮立即响应连续点击。
      current.queue = current.queue.then(async () => {
        try {
          if (next) await saveFavorite(current.source, current.id, data);
          else await deleteFavorite(current.source, current.id);
          current.confirmed = next;
        } catch {
          // 存储层已提示错误，只回退最新操作，避免覆盖后续点击。
          if (current.version === version) {
            current.optimistic = current.confirmed;
            publish(current);
          }
        }
      });
      return current.queue;
    },
    [key, publish]
  );

  const favorited =
    state.key === key
      ? state.value
      : statesRef.current.get(key)?.optimistic || false;
  return { favorited, toggleFavorite };
}
