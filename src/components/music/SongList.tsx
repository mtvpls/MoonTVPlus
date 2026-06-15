'use client';

import { useState } from 'react';
import { addMusicSongToPlaylist, playMusicLater, playMusicSong } from '@/lib/music/actions';
import { SourcePill } from '@/lib/music/shared';
import type { Song } from '@/lib/music/types';

function SongCover({ song }: { song: Song }) {
  const [failed, setFailed] = useState(false);
  const cover = song.pic && !failed ? song.pic : '';

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10 shadow-inner">
      {cover ? (
        <img
          src={cover}
          alt={`${song.name} 封面`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-500">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19V6l12-2v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2Zm12-2c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2Z" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default function SongList({ songs }: { songs: Song[] }) {
  return (
    <div className="space-y-1">
      {songs.map((song, index) => (
        <div
          key={`${song.platform}-${song.id}-${index}`}
          className="grid grid-cols-[32px_44px_1fr_auto_auto] md:grid-cols-[44px_48px_2fr_1fr_auto_auto] items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-all hover:bg-white/5"
        >
          <div className="text-center text-zinc-500 dark:text-zinc-300 text-sm" onClick={() => playMusicSong(song, index)}>
            {index + 1}
          </div>
          <div onClick={() => playMusicSong(song, index)}>
            <SongCover song={song} />
          </div>
          <div className="min-w-0" onClick={() => playMusicSong(song, index)}>
            <div className="text-sm font-medium text-white truncate">{song.name}</div>
            <div className="text-xs text-zinc-500 truncate md:hidden">{song.artist}</div>
          </div>
          <div className="hidden md:block text-sm text-zinc-400 truncate" onClick={() => playMusicSong(song, index)}>
            {song.artist}
          </div>
          <div className="flex items-center" onClick={() => playMusicSong(song, index)}>
            <SourcePill source={song.platform} />
          </div>
          <div className="flex flex-col items-center justify-center gap-0.5 leading-none">
            <button
              onClick={(e) => {
                e.stopPropagation();
                addMusicSongToPlaylist(song);
              }}
              className="text-zinc-500 hover:text-red-500 transition-colors p-0.5"
              title="添加到歌单"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                playMusicLater(song);
              }}
              className="text-zinc-500 hover:text-green-500 transition-colors p-0.5"
              title="稍后播放"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-9-9 9 9 0 019 9z" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
