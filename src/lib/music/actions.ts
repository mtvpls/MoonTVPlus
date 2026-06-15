'use client';

import type { Song } from '@/lib/music/types';

export function playMusicSong(song: Song, index = -1) {
  window.dispatchEvent(new CustomEvent('music:play-song', { detail: { song, index } }));
}

export function playMusicList(songs: Song[], title?: string) {
  window.dispatchEvent(new CustomEvent('music:play-all', { detail: { songs, title } }));
}

export function addMusicSongToPlaylist(song: Song) {
  window.dispatchEvent(new CustomEvent('music:add-to-playlist', { detail: { song } }));
}

export function playMusicLater(song: Song) {
  window.dispatchEvent(new CustomEvent('music:play-later', { detail: { song } }));
}
