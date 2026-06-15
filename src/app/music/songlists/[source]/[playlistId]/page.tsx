'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { playMusicList } from '@/lib/music/actions';
import MusicLoadingIndicator from '@/components/music/MusicLoadingIndicator';
import SongList from '@/components/music/SongList';
import { mapSong, normalizeSource } from '@/lib/music/shared';
import type { Song } from '@/lib/music/types';

export default function MusicSongListDetailPage() {
  const params = useParams<{ source: string; playlistId: string }>();
  const searchParams = useSearchParams();
  const source = normalizeSource(params.source);
  const playlistId = decodeURIComponent(params.playlistId);
  const title = searchParams.get('name') || '歌单详情';
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/music/v2/discovery/songlist-detail?source=${source}&id=${encodeURIComponent(playlistId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSongs((data.data?.list || []).map(mapSong));
        else setSongs([]);
      })
      .catch(() => setSongs([]))
      .finally(() => setLoading(false));
  }, [source, playlistId]);

  return loading ? (
    <MusicLoadingIndicator className="py-8" />
  ) : (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <div className="text-2xl font-black text-white tracking-tight truncate">{title}</div>
          <div className="mt-1 text-sm text-zinc-500">推荐歌单详情</div>
        </div>
        <button
          onClick={() => playMusicList(songs, title)}
          disabled={songs.length === 0}
          className="rounded-xl bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          播放全部
        </button>
      </div>
      <SongList songs={songs} />
    </div>
  );
}
