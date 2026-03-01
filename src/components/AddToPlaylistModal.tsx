/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useState } from 'react';

interface Song {
  id: string;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  platform: 'netease' | 'qq' | 'kuwo';
  duration?: number;
}

interface MusicPlaylist {
  id: string;
  username: string;
  name: string;
  description?: string;
  cover?: string;
  created_at: number;
  updated_at: number;
}

interface AddToPlaylistModalProps {
  song: Song | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export default function AddToPlaylistModal({
  song,
  isOpen,
  onClose,
  onSuccess,
  onError,
}: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [addingToPlaylistId, setAddingToPlaylistId] = useState<string | null>(null); // 正在添加的歌单ID

  // 加载用户的歌单列表
  useEffect(() => {
    if (isOpen) {
      loadPlaylists();
    }
  }, [isOpen]);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/music/playlists');
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data.playlists || []);
      }
    } catch (error) {
      console.error('加载歌单失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      onError?.('请输入歌单名称');
      return;
    }

    try {
      setCreating(true);
      const response = await fetch('/api/music/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPlaylistName.trim(),
          description: newPlaylistDescription.trim(),
        }),
      });

      if (response.ok) {
        setNewPlaylistName('');
        setNewPlaylistDescription('');
        setShowCreateForm(false);
        await loadPlaylists();
      } else {
        const data = await response.json();
        onError?.(data.error || '创建歌单失败');
      }
    } catch (error) {
      console.error('创建歌单失败:', error);
      onError?.('创建歌单失败');
    } finally {
      setCreating(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!song) return;

    try {
      setAddingToPlaylistId(playlistId);
      const response = await fetch('/api/music/playlists/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlistId,
          song: {
            platform: song.platform,
            id: song.id,
            name: song.name,
            artist: song.artist,
            album: song.album,
            pic: song.pic,
            duration: song.duration || 0,
          },
        }),
      });

      if (response.ok) {
        onSuccess?.();
        onClose();
      } else {
        const data = await response.json();
        onError?.(data.error || '添加失败');
      }
    } catch (error) {
      console.error('添加到歌单失败:', error);
      onError?.('添加到歌单失败');
    } finally {
      setAddingToPlaylistId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">添加到歌单</h3>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {song && (
            <div className="mt-2 text-sm text-zinc-400">
              {song.name} - {song.artist}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)]">
          {/* Create New Playlist Button */}
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full mb-4 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              创建新歌单
            </button>
          )}

          {/* Create Form */}
          {showCreateForm && (
            <div className="mb-4 p-4 bg-white/5 rounded-lg border border-white/10">
              <input
                type="text"
                placeholder="歌单名称"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-white/10 focus:border-green-500 focus:outline-none mb-2"
              />
              <textarea
                placeholder="歌单描述（可选）"
                value={newPlaylistDescription}
                onChange={(e) => setNewPlaylistDescription(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-white/10 focus:border-green-500 focus:outline-none resize-none"
                rows={2}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleCreatePlaylist}
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 text-white rounded-lg transition-colors"
                >
                  {creating ? '创建中...' : '确定'}
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewPlaylistName('');
                    setNewPlaylistDescription('');
                  }}
                  className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Playlists List */}
          {loading ? (
            <div className="text-center py-8 text-zinc-400">加载中...</div>
          ) : playlists.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">
              还没有歌单，创建一个吧
            </div>
          ) : (
            <div className="space-y-2">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handleAddToPlaylist(playlist.id)}
                  disabled={addingToPlaylistId !== null}
                  className="w-full px-4 py-3 bg-white/5 hover:bg-white/10 disabled:bg-white/5 disabled:cursor-not-allowed rounded-lg transition-colors text-left flex items-center gap-3"
                >
                  {playlist.cover ? (
                    <img
                      src={playlist.cover}
                      alt={playlist.name}
                      className="w-12 h-12 rounded object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center">
                      <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium truncate">{playlist.name}</div>
                    {playlist.description && (
                      <div className="text-xs text-zinc-500 truncate">{playlist.description}</div>
                    )}
                  </div>
                  {addingToPlaylistId === playlist.id ? (
                    <svg className="w-5 h-5 text-green-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
