'use client';

import { useCallback, useEffect, useState } from 'react';
import { playMusicList, playMusicSong } from '@/lib/music/actions';
import MusicLoadingIndicator from '@/components/music/MusicLoadingIndicator';
import { getApiErrorMessage } from '@/lib/music/errors';
import { mapSong, SourcePill } from '@/lib/music/shared';

export default function MusicMyPlaylistsPage() {
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [selectedUserPlaylist, setSelectedUserPlaylist] = useState<any | null>(null);
  const [userPlaylistSongs, setUserPlaylistSongs] = useState<any[]>([]);
  const [loadingUserPlaylists, setLoadingUserPlaylists] = useState(false);
  const [loadingUserPlaylistSongs, setLoadingUserPlaylistSongs] = useState(false);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);
  const [removingSongId, setRemovingSongId] = useState<string | null>(null);

  const loadUserPlaylists = useCallback(() => {
    setLoadingUserPlaylists(true);
    fetch('/api/music/v2/playlists')
      .then((res) => res.json())
      .then((data) => setUserPlaylists(data.data?.playlists || []))
      .catch(() => setUserPlaylists([]))
      .finally(() => setLoadingUserPlaylists(false));
  }, []);

  useEffect(() => {
    loadUserPlaylists();
  }, [loadUserPlaylists]);

  const normalizePlaylistSong = (song: any) => mapSong({
    ...song,
    id: song.songId || song.id,
    platform: song.source || song.platform,
    pic: song.cover || song.pic,
    duration: song.durationSec || song.duration,
  });

  const loadUserPlaylistSongs = useCallback((playlistId: string) => {
    setLoadingUserPlaylistSongs(true);
    fetch(`/api/music/v2/playlists/${playlistId}/songs`)
      .then((res) => res.json())
      .then((data) => setUserPlaylistSongs(data.data?.songs || []))
      .catch(() => setUserPlaylistSongs([]))
      .finally(() => setLoadingUserPlaylistSongs(false));
  }, []);

  const selectPlaylist = (playlist: any) => {
    setSelectedUserPlaylist(playlist);
    loadUserPlaylistSongs(playlist.id);
  };

  const deleteUserPlaylist = async (playlistId: string) => {
    if (!window.confirm('确定要删除这个歌单吗？')) return;

    setDeletingPlaylistId(playlistId);
    try {
      const response = await fetch(`/api/music/v2/playlists/${playlistId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(getApiErrorMessage(data.error, '删除失败'));
        return;
      }

      if (selectedUserPlaylist?.id === playlistId) {
        setSelectedUserPlaylist(null);
        setUserPlaylistSongs([]);
      }
      loadUserPlaylists();
    } catch (error) {
      console.error('删除歌单失败:', error);
      window.alert('删除歌单失败');
    } finally {
      setDeletingPlaylistId(null);
    }
  };

  const removeSongFromUserPlaylist = async (song: any) => {
    if (!selectedUserPlaylist) return;
    if (!window.confirm(`确定要从歌单中移除 "${song.name}" 吗？`)) return;

    setRemovingSongId(song.id);
    try {
      const response = await fetch(
        `/api/music/v2/playlists/${selectedUserPlaylist.id}/songs?songId=${encodeURIComponent(song.id)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(getApiErrorMessage(data.error, '移除失败'));
        return;
      }

      loadUserPlaylistSongs(selectedUserPlaylist.id);
    } catch (error) {
      console.error('移除歌曲失败:', error);
      window.alert('移除歌曲失败');
    } finally {
      setRemovingSongId(null);
    }
  };

  const mappedSongs = userPlaylistSongs.map(normalizePlaylistSong);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1">
        <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10">
          <h2 className="text-lg font-bold mb-4">歌单列表</h2>
          {loadingUserPlaylists ? <MusicLoadingIndicator className="py-8" /> : userPlaylists.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">还没有歌单</div>
          ) : (
            <div className="space-y-2">
              {userPlaylists.map((playlist) => (
                <div key={playlist.id} className={`p-3 rounded-lg cursor-pointer transition-colors ${selectedUserPlaylist?.id === playlist.id ? 'bg-green-600/20 border border-green-500' : 'bg-white/5 hover:bg-white/10'}`} onClick={() => selectPlaylist(playlist)}>
                  <div className="flex items-center gap-3">
                    {playlist.cover ? <img src={playlist.cover} alt={playlist.name} className="w-12 h-12 rounded object-cover" /> : <div className="w-12 h-12 rounded bg-zinc-700" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{playlist.name}</div>
                      {playlist.description && <div className="text-xs text-zinc-500 truncate">{playlist.description}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="md:col-span-2">
        {selectedUserPlaylist ? (
          <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">{selectedUserPlaylist.name}</h2>
                {selectedUserPlaylist.description && <p className="text-sm text-zinc-400 mt-1">{selectedUserPlaylist.description}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => playMusicList(mappedSongs, selectedUserPlaylist.name)} disabled={mappedSongs.length === 0} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg transition-colors">播放全部</button>
                <button
                  onClick={() => deleteUserPlaylist(selectedUserPlaylist.id)}
                  disabled={deletingPlaylistId !== null}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {deletingPlaylistId === selectedUserPlaylist.id ? '删除中...' : '删除歌单'}
                </button>
              </div>
            </div>
            {loadingUserPlaylistSongs ? <MusicLoadingIndicator className="py-8" /> : mappedSongs.length === 0 ? <div className="text-center py-8 text-zinc-400">歌单为空</div> : (
              <div className="space-y-2">
                {mappedSongs.map((song, index) => (
                  <div key={`${song.platform}+${song.id}`} className="flex items-center gap-2 p-2.5 md:gap-3 md:p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                    <div className="text-zinc-500 dark:text-zinc-300 text-xs md:text-sm w-6 md:w-8 text-center shrink-0">{index + 1}</div>
                    {song.pic && <img src={song.pic} alt={song.name} className="w-10 h-10 md:w-12 md:h-12 rounded object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0"><div className="font-medium truncate">{song.name}</div><SourcePill source={song.platform} /></div>
                      <div className="text-sm text-zinc-400 truncate">{song.artist}</div>
                    </div>
                    <button onClick={() => playMusicSong(song, index)} className="text-zinc-500 hover:text-green-500 transition-colors p-1 md:p-2 shrink-0" title="播放">▶</button>
                    <button
                      onClick={() => removeSongFromUserPlaylist(song)}
                      disabled={removingSongId === song.id}
                      className="text-zinc-500 hover:text-red-500 disabled:text-zinc-700 transition-colors p-1 md:p-2 shrink-0"
                      title="移除"
                    >
                      {removingSongId === song.id ? '…' : '✕'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10 h-full flex items-center justify-center"><div className="text-center text-zinc-400">选择一个歌单查看详情</div></div>
        )}
      </div>
    </div>
  );
}
