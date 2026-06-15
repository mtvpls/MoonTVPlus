'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { playMusicList } from '@/lib/music/actions';
import MusicLoadingIndicator from '@/components/music/MusicLoadingIndicator';
import SongList from '@/components/music/SongList';
import { mapSong, normalizeSource } from '@/lib/music/shared';
import type { Song } from '@/lib/music/types';

export default function MusicRankingDetailPage() {
  const params = useParams<{ source: string; playlistId: string }>();
  const searchParams = useSearchParams();
  const source = normalizeSource(params.source);
  const playlistId = decodeURIComponent(params.playlistId);
  const title = searchParams.get('name') || '排行榜';
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/music/v2/discovery/board-songs?source=${source}&boardId=${encodeURIComponent(playlistId)}`)
      .then((res) => res.json())
      .then((data) => setSongs((data.data?.list || []).map(mapSong)))
      .catch(() => setSongs([]))
      .finally(() => setLoading(false));
  }, [source, playlistId]);

  return loading ? <MusicLoadingIndicator className="py-8" /> : (
    <div>
      <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-2">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold text-white/80 tracking-tight truncate max-w-md">{title}</h2>
          <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-white shrink-0">{songs.length} 首歌曲</span>
        </div>
        <button
          onClick={() => playMusicList(songs, title)}
          disabled={songs.length === 0}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2 text-sm text-white shrink-0"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          播放全部
        </button>
      </div>
      <SongList songs={songs} />
    </div>
  );
}
