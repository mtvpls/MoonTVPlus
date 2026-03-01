/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getAllMusicPlayRecords,
  saveMusicPlayRecord,
  MusicPlayRecord,
  deleteMusicPlayRecord,
  clearAllMusicPlayRecords,
} from '@/lib/db.client';
import AddToPlaylistModal from '@/components/AddToPlaylistModal';
import Toast, { ToastProps } from '@/components/Toast';
import LyricsPiPWindow from '@/components/LyricsPiPWindow';

interface Song {
  id: string;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  platform: 'netease' | 'qq' | 'kuwo'; // 添加平台信息
}

interface PlayRecord {
  platform: 'netease' | 'qq' | 'kuwo';
  id: string;
  playTime: number; // 播放时间（秒）
  duration: number; // 总时长（秒）
  timestamp: number; // 添加时间戳
}

interface LyricLine {
  time: number;
  text: string;
}

interface Playlist {
  id: string;
  name: string;
  pic: string;
  updateFrequency?: string;
}

interface DbRecord {
  platform: 'netease' | 'qq' | 'kuwo';
  id: string;
  play_time: number;
  duration: number;
  save_time: number;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
}

// 扩展 Window 接口以支持 Document PiP API
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options: { width: number; height: number }) => Promise<Window>;
      window: Window | null;
    };
  }
}

export default function MusicPage() {
  const router = useRouter();
  const [currentSource, setCurrentSource] = useState<'netease' | 'qq' | 'kuwo'>('netease');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentView, setCurrentView] = useState<'playlists' | 'songs' | 'myPlaylists'>('playlists');
  const [currentPlaylistTitle, setCurrentPlaylistTitle] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [quality, setQuality] = useState<'128k' | '320k' | 'flac' | 'flac24bit'>('320k');
  const [playMode, setPlayMode] = useState<'loop' | 'single' | 'random'>('loop');
  const [currentSongIndex, setCurrentSongIndex] = useState(-1);
  const [showPlayer, setShowPlayer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [currentSongUrl, setCurrentSongUrl] = useState('');
  const [playRecords, setPlayRecords] = useState<PlayRecord[]>([]); // 播放记录（只存平台和ID）
  const [playlist, setPlaylist] = useState<Song[]>([]); // 完整歌曲信息（用于显示）
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlistIndex, setPlaylistIndex] = useState(-1); // 当前在播放列表中的索引
  const [showQualityMenu, setShowQualityMenu] = useState(false); // 音质选择菜单
  const [showVolumeSlider, setShowVolumeSlider] = useState(false); // 音量滑块显示状态
  const [pendingSongToPlay, setPendingSongToPlay] = useState<{ platform: string; id: string } | null>(null); // 待播放的歌曲信息
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false); // 添加到歌单弹窗
  const [songToAddToPlaylist, setSongToAddToPlaylist] = useState<Song | null>(null); // 要添加到歌单的歌曲

  // 我的歌单相关状态
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [selectedUserPlaylist, setSelectedUserPlaylist] = useState<any | null>(null);
  const [userPlaylistSongs, setUserPlaylistSongs] = useState<any[]>([]);
  const [loadingUserPlaylists, setLoadingUserPlaylists] = useState(false);
  const [loadingUserPlaylistSongs, setLoadingUserPlaylistSongs] = useState(false);
  const [loadingPlayAll, setLoadingPlayAll] = useState(false); // 播放全部加载状态
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null); // 正在删除的歌单ID

  // Toast 和 Confirm Modal 状态
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  // PiP 相关状态
  const [showPiPLyrics, setShowPiPLyrics] = useState(false);
  const [pipOpacity, setPipOpacity] = useState(0.9);
  const [pipMinimized, setPipMinimized] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const restoredTimeRef = useRef<number>(0);
  const songStartTimeRef = useRef<number>(0); // 歌曲开始播放的时间戳

  // 工具函数：处理图片 URL（在 HTTPS 环境下代理 HTTP 图片）
  const processImageUrl = (url: string | undefined, platform: string): string | undefined => {
    if (!url) return url;

    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

    // 只对酷我音乐的 HTTP 图片在 HTTPS 环境下进行代理
    if (platform === 'kuwo' && isHttps && url.startsWith('http://')) {
      return `/api/music/proxy?url=${encodeURIComponent(url)}`;
    }

    return url;
  };

  // 保存播放状态到 localStorage
  const savePlayState = () => {
    if (!currentSong) return;

    const playState = {
      currentSong,
      currentSongIndex,
      songs,
      currentPlaylistTitle,
      currentSource,
      currentView,
      quality,
      playMode,
      volume,
      currentTime: audioRef.current?.currentTime || 0,
      currentSongUrl,
      lyrics,
      playRecords, // 只保存播放记录（平台+ID+播放信息）
      playlist, // 保存完整歌曲信息（用于显示）
      playlistIndex,
    };

    localStorage.setItem('musicPlayState', JSON.stringify(playState));
  };

  // 从 localStorage 恢复播放状态（已废弃，现在统一使用数据库）
  const restorePlayState = async () => {
    // 此函数已不再使用，所有状态恢复都在 initializePlayState 中完成
  };

  // 页面加载时恢复播放状态和数据库记录
  useEffect(() => {
    const initializePlayState = async () => {
      try {
        // 1. 直接从 API 同步加载播放记录（阻塞等待，不使用缓存）
        const response = await fetch('/api/music/playrecords');
        const dbRecords = await response.json();

        // 将数据库记录转换为前端格式
        const records: PlayRecord[] = [];
        const songs: Song[] = [];

        Object.entries(dbRecords).forEach(([key, record]) => {
          const dbRecord = record as DbRecord;
          records.push({
            platform: dbRecord.platform,
            id: dbRecord.id,
            playTime: dbRecord.play_time,
            duration: dbRecord.duration,
            timestamp: dbRecord.save_time,
          });

          songs.push({
            id: dbRecord.id,
            name: dbRecord.name,
            artist: dbRecord.artist,
            album: dbRecord.album,
            pic: dbRecord.pic,
            platform: dbRecord.platform,
          });
        });

        // 按 save_time 倒序排序
        const sortedIndices = records
          .map((record, index) => ({ record, index }))
          .sort((a, b) => b.record.timestamp - a.record.timestamp);

        const sortedRecords = sortedIndices.map(item => records[item.index]);
        const sortedSongs = sortedIndices.map(item => songs[item.index]);

        // 2. 更新播放列表
        if (sortedRecords.length > 0) {
          setPlayRecords(sortedRecords);
          setPlaylist(sortedSongs);
        }

        // 3. 获取 localStorage 配置（只获取配置，不获取歌曲信息）
        const savedPlayState = localStorage.getItem('musicPlayState');
        const playState = savedPlayState ? JSON.parse(savedPlayState) : {};

        // 恢复配置状态（不包括歌曲）
        setSongs(playState.songs || []);
        setCurrentPlaylistTitle(playState.currentPlaylistTitle || '');
        setCurrentSource(playState.currentSource || 'netease');
        setCurrentView(playState.currentView || 'playlists');
        setQuality(playState.quality || '320k');
        setPlayMode(playState.playMode || 'loop');
        setVolume(playState.volume || 100);

        // 4. 使用数据库的最新记录（歌曲和进度都从数据库获取）
        if (sortedRecords.length > 0) {
          const latestDbRecord = sortedRecords[0];
          const latestDbSong = sortedSongs[0];

          // 使用数据库的歌曲信息
          setCurrentSong(latestDbSong);
          setPlaylistIndex(0);
          setShowPlayer(true);

          // 从数据库恢复播放进度
          const dbPlayTime = latestDbRecord.playTime || 0;
          songStartTimeRef.current = Date.now();

          // 5. 同步解析歌曲获取播放链接（阻塞等待）
          const platform = latestDbSong.platform || 'netease';

          console.log('开始解析歌曲:', platform, latestDbSong.id);

          const parseResponse = await fetch('/api/music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'parse',
              platform: platform,
              ids: latestDbSong.id,
              quality: playState.quality || '320k',
            }),
          });

          let data = await parseResponse.json();
          // 执行前端 transform（如果有）
          data = executeTransform(data);

          if (data.code === 0 && data.data?.data && data.data.data.length > 0) {
            const songData = data.data.data[0];

            if (songData.url && songData.success) {
              let playUrl = songData.url;
              if (platform === 'kuwo') {
                playUrl = `/api/music/proxy?url=${encodeURIComponent(songData.url)}`;
              }

              setCurrentSongUrl(songData.url);

              if (songData.lyrics) {
                const parsedLyrics = parseLyric(songData.lyrics);
                setLyrics(parsedLyrics);
              }

              // 6. 等待所有数据准备好后，再设置音频源和进度
              if (audioRef.current) {
                audioRef.current.src = playUrl;

                const restoreTime = () => {
                  if (audioRef.current && dbPlayTime > 0) {
                    audioRef.current.currentTime = dbPlayTime;
                  }
                };

                audioRef.current.addEventListener('loadedmetadata', restoreTime, { once: true });
                audioRef.current.load();
              }
            }
          }
        }
      } catch (error) {
        console.error('加载播放记录失败:', error);
      }
    };

    initializePlayState();
  }, []);

  // 恢复 PiP 偏好设置
  useEffect(() => {
    const savedOpacity = localStorage.getItem('lyricsPiPOpacity');
    const savedMinimized = localStorage.getItem('lyricsPiPMinimized');
    if (savedOpacity) setPipOpacity(parseFloat(savedOpacity));
    if (savedMinimized) setPipMinimized(savedMinimized === 'true');
  }, []);

  // 监听来自 PiP 窗口的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      switch (event.data.type) {
        case 'PIP_OPACITY_CHANGE':
          setPipOpacity(event.data.opacity);
          localStorage.setItem('lyricsPiPOpacity', event.data.opacity.toString());
          break;
        case 'PIP_MINIMIZED_CHANGE':
          setPipMinimized(event.data.minimized);
          localStorage.setItem('lyricsPiPMinimized', event.data.minimized.toString());
          break;
        case 'PIP_CLOSE':
          setShowPiPLyrics(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 监听播放状态变化，自动保存
  useEffect(() => {
    if (currentSong) {
      savePlayState();
    }
  }, [currentSong, currentSongIndex, songs, currentPlaylistTitle, currentSource, currentView, quality, playMode, volume, currentSongUrl, lyrics, playRecords, playlistIndex]);

  // 监听 playRecords 变化，更新 playlistIndex
  useEffect(() => {
    if (pendingSongToPlay) {
      const index = playRecords.findIndex(
        r => r.platform === pendingSongToPlay.platform && r.id === pendingSongToPlay.id
      );
      setPlaylistIndex(index);
      setPendingSongToPlay(null);
    }
  }, [playRecords, pendingSongToPlay]);

  // 同步音量状态到 audio 元素
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  // 执行前端 transform（用于 Cloudflare 环境）
  const executeTransform = (data: any) => {
    if (data && typeof data === 'object' && data.__transform) {
      try {
        // eslint-disable-next-line no-eval
        const transformFn = eval(`(${data.__transform})`);
        delete data.__transform; // 删除 transform 字段
        return transformFn(data);
      } catch (err) {
        console.error('[Frontend] Transform 函数执行失败:', err);
        delete data.__transform;
        return data;
      }
    }
    return data;
  };

  // 加载排行榜列表
  const loadPlaylists = async (source: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/music?action=toplists&platform=${source}`
      );
      let data = await response.json();
      // 执行前端 transform（如果有）
      data = executeTransform(data);
      // 确保返回的是数组
      setPlaylists(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('加载排行榜失败:', error);
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载歌单详情
  const loadPlaylist = async (playlistId: string, playlistName: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/music?action=toplist&platform=${currentSource}&id=${playlistId}`
      );
      let data = await response.json();
      // 执行前端 transform（如果有）
      data = executeTransform(data);
      // 确保返回的是数组
      setSongs(Array.isArray(data) ? data : []);
      setCurrentPlaylistTitle(playlistName);
      setCurrentView('songs');
    } catch (error) {
      console.error('加载歌单失败:', error);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  };

  // 搜索歌曲
  const searchSongs = async () => {
    if (!searchKeyword.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/music?action=search&platform=${currentSource}&keyword=${encodeURIComponent(searchKeyword)}&page=1&pageSize=20`
      );
      let data = await response.json();
      // 执行前端 transform（如果有）
      data = executeTransform(data);
      // 确保返回的是数组
      setSongs(Array.isArray(data) ? data : []);
      setCurrentPlaylistTitle(`搜索: ${searchKeyword}`);
      setCurrentView('songs');
    } catch (error) {
      console.error('搜索失败:', error);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  };

  // 打开添加到歌单弹窗
  const handleAddToPlaylist = (song: Song, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发播放
    setSongToAddToPlaylist(song);
    setShowAddToPlaylistModal(true);
  };

  // 加载用户歌单列表
  const loadUserPlaylists = async () => {
    try {
      setLoadingUserPlaylists(true);
      const response = await fetch('/api/music/playlists');
      if (response.ok) {
        const data = await response.json();
        setUserPlaylists(data.playlists || []);
      }
    } catch (error) {
      console.error('加载歌单失败:', error);
    } finally {
      setLoadingUserPlaylists(false);
    }
  };

  // 加载歌单中的歌曲
  const loadUserPlaylistSongs = async (playlistId: string) => {
    try {
      setLoadingUserPlaylistSongs(true);
      const response = await fetch(`/api/music/playlists/songs?playlistId=${playlistId}`);
      if (response.ok) {
        const data = await response.json();
        setUserPlaylistSongs(data.songs || []);
      }
    } catch (error) {
      console.error('加载歌单歌曲失败:', error);
    } finally {
      setLoadingUserPlaylistSongs(false);
    }
  };

  // 选择歌单
  const handleSelectUserPlaylist = (playlist: any) => {
    setSelectedUserPlaylist(playlist);
    loadUserPlaylistSongs(playlist.id);
  };

  // 播放全部歌单歌曲
  const handlePlayAllPlaylist = async () => {
    if (!selectedUserPlaylist || userPlaylistSongs.length === 0) {
      setToast({
        message: '歌单为空',
        type: 'error',
        onClose: () => setToast(null),
      });
      return;
    }

    setLoadingPlayAll(true);
    try {
      // 1. 清空所有播放历史
      await clearAllMusicPlayRecords();

      // 2. 清空本地状态
      setPlayRecords([]);
      setPlaylist([]);

      // 3. 批量添加歌单中的所有歌曲到播放历史
      const baseTime = Date.now();
      const recordsToAdd = userPlaylistSongs.map((song, i) => ({
        key: `${song.platform}+${song.id}`,
        record: {
          platform: song.platform,
          id: song.id,
          name: song.name,
          artist: song.artist,
          album: song.album,
          pic: song.pic,
          play_time: 0,
          duration: song.duration || 0,
          save_time: baseTime + i, // 使用递增的时间戳
        },
      }));

      // 一次性批量添加所有歌曲
      const response = await fetch('/api/music/playrecords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: recordsToAdd,
        }),
      });

      if (!response.ok) {
        throw new Error('批量添加歌曲失败');
      }

      // 4. 立即更新本地状态
      const newRecords: PlayRecord[] = userPlaylistSongs.map((song, i) => ({
        platform: song.platform,
        id: song.id,
        playTime: 0,
        duration: song.duration || 0,
        timestamp: baseTime + i,
      }));

      const newPlaylist: Song[] = userPlaylistSongs.map((song) => ({
        id: song.id,
        name: song.name,
        artist: song.artist,
        album: song.album,
        pic: song.pic,
        platform: song.platform,
      }));

      setPlayRecords(newRecords);
      setPlaylist(newPlaylist);

      // 5. 直接播放第一首歌
      if (userPlaylistSongs.length > 0) {
        setPlaylistIndex(0);
        await playSong(userPlaylistSongs[0], 0);
      }

      setToast({
        message: `已将 ${userPlaylistSongs.length} 首歌曲添加到播放列表`,
        type: 'success',
        onClose: () => setToast(null),
      });
    } catch (error) {
      console.error('播放全部失败:', error);
      setToast({
        message: '播放全部失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setLoadingPlayAll(false);
    }
  };

  // 删除歌单
  const handleDeleteUserPlaylist = async (playlistId: string) => {
    setConfirmModal({
      isOpen: true,
      title: '确认删除',
      message: '确定要删除这个歌单吗？',
      onConfirm: async () => {
        // 先关闭确认框
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });

        // 然后执行删除
        setDeletingPlaylistId(playlistId);
        try {
          const response = await fetch(`/api/music/playlists?playlistId=${playlistId}`, {
            method: 'DELETE',
          });

          if (response.ok) {
            setToast({
              message: '删除成功',
              type: 'success',
              onClose: () => setToast(null),
            });
            if (selectedUserPlaylist?.id === playlistId) {
              setSelectedUserPlaylist(null);
              setUserPlaylistSongs([]);
            }
            loadUserPlaylists();
          } else {
            const data = await response.json();
            setToast({
              message: data.error || '删除失败',
              type: 'error',
              onClose: () => setToast(null),
            });
          }
        } catch (error) {
          console.error('删除歌单失败:', error);
          setToast({
            message: '删除歌单失败',
            type: 'error',
            onClose: () => setToast(null),
          });
        } finally {
          setDeletingPlaylistId(null);
        }
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  // 从歌单中移除歌曲
  const handleRemoveSongFromUserPlaylist = async (song: any) => {
    if (!selectedUserPlaylist) return;

    setConfirmModal({
      isOpen: true,
      title: '确认移除',
      message: `确定要从歌单中移除 "${song.name}" 吗？`,
      onConfirm: async () => {
        try {
          const response = await fetch(
            `/api/music/playlists/songs?playlistId=${selectedUserPlaylist.id}&platform=${song.platform}&songId=${song.id}`,
            { method: 'DELETE' }
          );

          if (response.ok) {
            setToast({
              message: '移除成功',
              type: 'success',
              onClose: () => setToast(null),
            });
            loadUserPlaylistSongs(selectedUserPlaylist.id);
          } else {
            const data = await response.json();
            setToast({
              message: data.error || '移除失败',
              type: 'error',
              onClose: () => setToast(null),
            });
          }
        } catch (error) {
          console.error('移除歌曲失败:', error);
          setToast({
            message: '移除歌曲失败',
            type: 'error',
            onClose: () => setToast(null),
          });
        }
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  // 播放歌曲
  const playSong = async (song: Song, index: number) => {
    try {
      // 使用歌曲自己的平台信息，如果没有则使用当前选择的平台
      const platform = song.platform || currentSource;

      // 记录歌曲开始播放的时间
      songStartTimeRef.current = Date.now();

      // 先设置当前歌曲和显示播放器
      setCurrentSong(song);
      setCurrentSongIndex(index);
      setShowPlayer(true);
      setLyrics([]); // 清空旧歌词

      // 添加到播放记录和播放列表
      const record: PlayRecord = {
        platform: platform,
        id: song.id,
        playTime: 0, // 初始播放时间
        duration: 0, // 将在音频加载后更新
        timestamp: Date.now(),
      };

      // 设置待播放歌曲信息，用于在 playRecords 更新后找到索引
      setPendingSongToPlay({ platform, id: song.id });

      setPlayRecords(prev => {
        const existingIndex = prev.findIndex(r => r.platform === record.platform && r.id === record.id);
        if (existingIndex >= 0) {
          // 记录已存在，更新时间戳但不重置播放时间
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            timestamp: Date.now(),
          };
          return updated;
        } else {
          // 新记录，添加到列表末尾
          return [...prev, record];
        }
      });

      setPlaylist(prev => {
        const existingIndex = prev.findIndex(s => s.id === song.id && s.platform === platform);
        if (existingIndex >= 0) {
          return prev;
        } else {
          return [...prev, { ...song, platform }];
        }
      });

      // 调用解析接口获取播放链接
      const response = await fetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'parse',
          platform: platform, // 使用歌曲的平台
          ids: song.id,
          quality: quality,
        }),
      });

      let data = await response.json();
      // 执行前端 transform（如果有）
      data = executeTransform(data);

      // TuneHub 返回格式: { code: 0, data: { data: [...] } }
      if (data.code === 0 && data.data?.data && data.data.data.length > 0) {
        const songData = data.data.data[0];

        if (songData.url && songData.success) {
          // 处理封面图片（在 HTTPS 环境下代理 HTTP 图片）
          const coverUrl = processImageUrl(songData.cover, platform);

          // 更新歌曲信息，包括封面
          if (coverUrl) {
            setCurrentSong({
              ...song,
              pic: coverUrl,
              platform,
            });
          }

          // 解析歌词
          if (songData.lyrics) {
            const parsedLyrics = parseLyric(songData.lyrics);
            setLyrics(parsedLyrics);
          }

          // 保存原始 URL 用于下载
          setCurrentSongUrl(songData.url);

          // 对于酷我音乐，使用代理
          let playUrl = songData.url;
          if (platform === 'kuwo') {
            playUrl = `/api/music/proxy?url=${encodeURIComponent(songData.url)}`;
          }

          if (audioRef.current) {
            audioRef.current.src = playUrl;
            audioRef.current.load();
            audioRef.current.play().catch(err => {
              console.error('播放失败:', err);
            });
            setIsPlaying(true);
          }
        } else {
          console.error('无法获取播放链接，songData:', songData);
        }
      } else {
        console.error('解析失败，完整响应:', data);
      }
    } catch (error) {
      console.error('播放失败:', error);
    }
  };

  // 解析歌词文本
  const parseLyric = (lyricText: string): LyricLine[] => {
    if (!lyricText) return [];

    const lines = lyricText.split('\n');
    const lyricLines: LyricLine[] = [];

    // 匹配 [mm:ss.xx] 或 [mm:ss] 格式
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

    lines.forEach(line => {
      const matches = Array.from(line.matchAll(timeRegex));
      if (matches.length > 0) {
        // 提取歌词文本（去掉所有时间标签）
        const text = line.replace(timeRegex, '').trim();
        if (text) {
          // 一行可能有多个时间标签
          matches.forEach(match => {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
            const time = minutes * 60 + seconds + milliseconds / 1000;
            lyricLines.push({ time, text });
          });
        }
      }
    });

    // 按时间排序
    return lyricLines.sort((a, b) => a.time - b.time);
  };

  // 切换播放/暂停
  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        // 暂停时保存状态到 localStorage 和数据库
        savePlayState();

        // 前5秒不保存（避免加载时的跳转触发保存）
        if (Date.now() - songStartTimeRef.current < 5000) {
          return;
        }

        // 保存到数据库
        if (currentSong && playlistIndex >= 0 && playRecords[playlistIndex]) {
          const record = playRecords[playlistIndex];
          const dbRecord: MusicPlayRecord = {
            platform: record.platform,
            id: record.id,
            name: currentSong.name,
            artist: currentSong.artist,
            album: currentSong.album,
            pic: currentSong.pic,
            play_time: audioRef.current.currentTime,
            duration: audioRef.current.duration || 0,
            save_time: Date.now(),
          };

          saveMusicPlayRecord(record.platform, record.id, dbRecord).catch(err => {
            console.error('暂停时保存播放记录失败:', err);
          });
        }
      } else {
        audioRef.current.play().catch(err => {
          console.error('播放失败:', err);
        });
        setIsPlaying(true);
      }
    }
  };

  // 上一曲
  const playPrev = () => {
    // 优先从播放列表切换
    if (playlist.length > 0) {
      // 如果已经是第一首，循环到最后一首
      const prevIndex = playlistIndex > 0 ? playlistIndex - 1 : playlist.length - 1;
      setPlaylistIndex(prevIndex);
      playSong(playlist[prevIndex], -1);
    } else if (currentSongIndex > 0) {
      playSong(songs[currentSongIndex - 1], currentSongIndex - 1);
    }
  };

  // 下一曲
  const playNext = () => {
    // 优先从播放列表切换
    if (playlist.length > 0) {
      // 如果已经是最后一首，循环到第一首
      const nextIndex = playlistIndex < playlist.length - 1 ? playlistIndex + 1 : 0;
      setPlaylistIndex(nextIndex);
      playSong(playlist[nextIndex], -1);
    } else if (currentSongIndex < songs.length - 1) {
      playSong(songs[currentSongIndex + 1], currentSongIndex + 1);
    }
  };

  // 切换音质
  const cycleQuality = () => {
    const qualities: Array<'128k' | '320k' | 'flac' | 'flac24bit'> = ['128k', '320k', 'flac', 'flac24bit'];
    const currentIndex = qualities.indexOf(quality);
    const nextIndex = (currentIndex + 1) % qualities.length;
    setQuality(qualities[nextIndex]);
  };

  // 切换播放模式
  const toggleMode = () => {
    const modes: Array<'loop' | 'single' | 'random'> = ['loop', 'single', 'random'];
    const currentIndex = modes.indexOf(playMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setPlayMode(modes[nextIndex]);
  };

  // 返回
  const goBack = () => {
    if (currentView === 'songs') {
      setCurrentView('playlists');
      setSongs([]);
    } else if (currentView === 'myPlaylists') {
      setCurrentView('playlists');
      setSelectedUserPlaylist(null);
      setUserPlaylistSongs([]);
    } else {
      router.back();
    }
  };

  // 下载歌曲
  const downloadSong = () => {
    if (!currentSongUrl || !currentSong) return;

    // 创建一个临时的 a 标签来触发下载
    const link = document.createElement('a');
    link.href = currentSongUrl;
    link.download = `${currentSong.name} - ${currentSong.artist}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 切换平台
  const switchSource = (source: 'netease' | 'qq' | 'kuwo') => {
    setCurrentSource(source);
    setCurrentView('playlists');
    setSongs([]);
    setSearchKeyword('');
  };

  // 音频事件监听
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // 更新当前歌词索引
      if (lyrics.length > 0) {
        let index = -1;
        for (let i = 0; i < lyrics.length; i++) {
          if (lyrics[i].time <= audio.currentTime) {
            index = i;
          } else {
            break;
          }
        }
        setCurrentLyricIndex(index);
      }

      // 每20秒保存一次播放进度和播放时间
      const now = Date.now();
      if (now - lastSaveTimeRef.current > 20000) {
        lastSaveTimeRef.current = now;

        // 前5秒不保存（避免加载时的跳转触发保存）
        if (Date.now() - songStartTimeRef.current < 5000) {
          return;
        }

        // 更新当前播放记录的播放时间
        if (currentSong && playlistIndex >= 0) {
          setPlayRecords(prev => {
            const updated = [...prev];
            if (updated[playlistIndex]) {
              updated[playlistIndex] = {
                ...updated[playlistIndex],
                playTime: audio.currentTime,
              };

              // 保存到数据库
              const record = updated[playlistIndex];
              const dbRecord: MusicPlayRecord = {
                platform: record.platform,
                id: record.id,
                name: currentSong.name,
                artist: currentSong.artist,
                album: currentSong.album,
                pic: currentSong.pic,
                play_time: audio.currentTime,
                duration: audio.duration || 0,
                save_time: Date.now(),
              };

              saveMusicPlayRecord(record.platform, record.id, dbRecord).catch(err => {
                console.error('保存播放记录到数据库失败:', err);
              });
            }
            return updated;
          });
        }

        savePlayState();
      }
    };

    const handleLoadedMetadata = () => {
      // 恢复播放进度
      if (restoredTimeRef.current > 0) {
        audio.currentTime = restoredTimeRef.current;
        restoredTimeRef.current = 0; // 清除标记
      }
    };

    const handleDurationChange = () => {
      setDuration(audio.duration);

      // 前5秒不保存（避免加载时的跳转触发保存）
      if (Date.now() - songStartTimeRef.current < 5000) {
        return;
      }

      // 更新当前播放记录的总时长
      if (currentSong && playlistIndex >= 0) {
        setPlayRecords(prev => {
          const updated = [...prev];
          if (updated[playlistIndex]) {
            updated[playlistIndex] = {
              ...updated[playlistIndex],
              duration: audio.duration,
            };

            // 保存到数据库（包含时长信息）
            const record = updated[playlistIndex];
            const dbRecord: MusicPlayRecord = {
              platform: record.platform,
              id: record.id,
              name: currentSong.name,
              artist: currentSong.artist,
              album: currentSong.album,
              pic: currentSong.pic,
              play_time: record.playTime,
              duration: audio.duration,
              save_time: Date.now(),
            };

            saveMusicPlayRecord(record.platform, record.id, dbRecord).catch(err => {
              console.error('保存播放记录到数据库失败:', err);
            });
          }
          return updated;
        });
      }
    };
    const handleEnded = () => {
      if (playMode === 'single') {
        audio.currentTime = 0;
        audio.play();
      } else if (playMode === 'random') {
        // 优先从播放列表中随机选择
        if (playlist.length > 0) {
          const randomIndex = Math.floor(Math.random() * playlist.length);
          setPlaylistIndex(randomIndex);
          playSong(playlist[randomIndex], -1);
        } else if (songs.length > 0) {
          const randomIndex = Math.floor(Math.random() * songs.length);
          playSong(songs[randomIndex], randomIndex);
        }
      } else {
        playNext();
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playMode, songs, currentSongIndex, lyrics, currentSong, playlistIndex, playRecords]);

  // 初始加载
  useEffect(() => {
    loadPlaylists(currentSource);
  }, [currentSource]);

  // 当切换到我的歌单视图时加载歌单列表
  useEffect(() => {
    if (currentView === 'myPlaylists') {
      loadUserPlaylists();
    }
  }, [currentView]);

  // 歌词自动滚动
  useEffect(() => {
    if (lyricsContainerRef.current && currentLyricIndex >= 0) {
      const container = lyricsContainerRef.current;
      const activeLine = container.querySelector(`[data-index="${currentLyricIndex}"]`);
      if (activeLine) {
        activeLine.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentLyricIndex]);

  // 搜索框回车
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      searchSongs();
    }
  };

  // 进度条拖动
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  // 音量调节
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  // 触摸/鼠标滑动音量调节（移动端兼容）
  const handleVolumeSliderInteraction = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const slider = e.currentTarget;
    const rect = slider.getBoundingClientRect();

    const updateVolume = (clientY: number) => {
      // 计算相对于滑块顶部的位置
      const y = clientY - rect.top;
      // 限制在滑块范围内
      const clampedY = Math.max(0, Math.min(rect.height, y));
      // 从上到下：0% -> 100%，从下到上：100% -> 0%
      const percentage = 100 - (clampedY / rect.height) * 100;
      const newVolume = Math.round(percentage);

      setVolume(newVolume);
      if (audioRef.current) {
        audioRef.current.volume = newVolume / 100;
      }
    };

    // 获取初始触摸/点击位置
    const clientY = 'touches' in e ? e.touches[0]?.clientY || 0 : e.clientY;
    updateVolume(clientY);

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      moveEvent.preventDefault();
      const moveClientY = 'touches' in moveEvent ? moveEvent.touches[0]?.clientY || 0 : moveEvent.clientY;
      updateVolume(moveClientY);
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
  };

  // PiP 窗口管理
  const togglePiPLyrics = () => {
    if (!('documentPictureInPicture' in window)) {
      setToast({
        message: '您的浏览器不支持画中画功能，请使用 Chrome 116+ 版本',
        type: 'error',
      });
      // 降级方案：打开全屏歌词
      setShowLyrics(true);
      return;
    }

    if (!currentSong) {
      setToast({
        message: '请先播放歌曲',
        type: 'info',
      });
      return;
    }

    setShowPiPLyrics(!showPiPLyrics);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const getQualityLabel = () => {
    switch (quality) {
      case '128k': return '标准';
      case '320k': return 'HQ';
      case 'flac': return 'SQ';
      case 'flac24bit': return 'HR';
    }
  };

  const getSourceLabel = () => {
    switch (currentSource) {
      case 'netease': return '网易云';
      case 'qq': return 'QQ音乐';
      case 'kuwo': return '酷我';
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-b border-white/10 px-4 md:px-6">
        <div className="w-full mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 py-3">
          <div className="flex items-center justify-between md:justify-start md:gap-6 w-full md:w-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="返回首页"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-green-500">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                </svg>
              </div>
              <span className="font-bold text-lg text-white">音乐</span>
            </div>
            <div className="flex bg-white/5 rounded-lg p-1 gap-1 border border-white/5">
              <button
                onClick={() => switchSource('netease')}
                className={`px-3 py-1 md:px-4 rounded text-[10px] font-bold tracking-wider transition-all ${
                  currentSource === 'netease'
                    ? 'bg-green-500 text-white border border-white/30 shadow-lg shadow-green-500/50'
                    : 'text-zinc-400 border border-transparent'
                }`}
              >
                NET
              </button>
              <button
                onClick={() => switchSource('qq')}
                className={`px-3 py-1 md:px-4 rounded text-[10px] font-bold tracking-wider transition-all ${
                  currentSource === 'qq'
                    ? 'bg-green-500 text-white border border-white/30 shadow-lg shadow-green-500/50'
                    : 'text-zinc-400 border border-transparent'
                }`}
              >
                QQ
              </button>
              <button
                onClick={() => switchSource('kuwo')}
                className={`px-3 py-1 md:px-4 rounded text-[10px] font-bold tracking-wider transition-all ${
                  currentSource === 'kuwo'
                    ? 'bg-green-500 text-white border border-white/30 shadow-lg shadow-green-500/50'
                    : 'text-zinc-400 border border-transparent'
                }`}
              >
                酷我
              </button>
            </div>
          </div>
          <div className="flex items-center w-full md:flex-1 md:max-w-md md:ml-auto h-10 md:h-9 gap-2">
            {(currentView === 'songs' || currentView === 'myPlaylists') && (
              <button
                onClick={goBack}
                className="w-10 h-full rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white border border-white/10"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="relative group w-full h-full">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-zinc-500 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full h-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-4 text-sm text-white focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/50 font-mono placeholder-zinc-500"
                placeholder="搜索歌曲或艺术家..."
              />
            </div>
            <button
              onClick={() => setCurrentView('myPlaylists')}
              className="w-10 h-full rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white border border-white/10 shrink-0"
              title="我的歌单"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-[120px] md:pt-[96px] pb-32 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          {loading && (
            <div className="text-center text-zinc-500 py-8">加载中...</div>
          )}

          {/* Playlists View */}
          {currentView === 'playlists' && !loading && (
            <div>
              <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-2">
                <h2 className="text-xs font-mono text-white/50 tracking-widest">排行榜</h2>
                <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-white">
                  {getSourceLabel()}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    onClick={() => loadPlaylist(playlist.id, playlist.name)}
                    className="cursor-pointer group"
                  >
                    <div className="relative aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
                      {playlist.pic && (
                        <img
                          src={playlist.pic}
                          alt={playlist.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                      </div>
                    </div>
                    <h3 className="text-sm font-medium text-white/80 truncate">{playlist.name}</h3>
                    {playlist.updateFrequency && (
                      <p className="text-xs text-zinc-500 mt-1">{playlist.updateFrequency}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Songs View */}
          {currentView === 'songs' && !loading && (
            <div>
              <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-2">
                <h2 className="text-xl font-bold text-white/80 tracking-tight truncate max-w-md">
                  {currentPlaylistTitle}
                </h2>
                <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-white shrink-0">
                  {songs.length} 首歌曲
                </span>
              </div>
              <div className="space-y-1">
                {songs.map((song, index) => (
                  <div
                    key={`${song.id}-${index}`}
                    className={`grid grid-cols-[40px_1fr_auto_auto] md:grid-cols-[50px_2fr_1fr_auto_auto] gap-2 px-3 py-3 rounded-lg cursor-pointer transition-all ${
                      currentSongIndex === index
                        ? 'bg-white/12 border-l-2 border-green-500'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div
                      className="text-center text-zinc-500 text-sm col-span-1"
                      onClick={() => playSong(song, index)}
                    >
                      {index + 1}
                    </div>
                    <div
                      className="min-w-0 col-span-1"
                      onClick={() => playSong(song, index)}
                    >
                      <div className="text-sm font-medium text-white truncate">{song.name}</div>
                      <div className="text-xs text-zinc-500 truncate md:hidden">{song.artist}</div>
                    </div>
                    <div
                      className="hidden md:block text-sm text-zinc-400 truncate col-span-1"
                      onClick={() => playSong(song, index)}
                    >
                      {song.artist}
                    </div>
                    <div
                      className="text-xs text-zinc-600 col-span-1"
                      onClick={() => playSong(song, index)}
                    >
                      {getSourceLabel()}
                    </div>
                    <button
                      onClick={(e) => handleAddToPlaylist(song, e)}
                      className="text-zinc-500 hover:text-red-500 transition-colors p-1 col-span-1"
                      title="添加到歌单"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My Playlists View */}
          {currentView === 'myPlaylists' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Playlists List */}
              <div className="md:col-span-1">
                <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10">
                  <h2 className="text-lg font-bold mb-4">歌单列表</h2>
                  {loadingUserPlaylists ? (
                    <div className="text-center py-8 text-zinc-400">加载中...</div>
                  ) : userPlaylists.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400">
                      还没有歌单
                      <br />
                      <button
                        onClick={() => setCurrentView('playlists')}
                        className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                      >
                        去添加歌曲
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userPlaylists.map((playlist) => (
                        <div
                          key={playlist.id}
                          className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            selectedUserPlaylist?.id === playlist.id
                              ? 'bg-green-600/20 border border-green-500'
                              : 'bg-white/5 hover:bg-white/10'
                          }`}
                          onClick={() => handleSelectUserPlaylist(playlist)}
                        >
                          <div className="flex items-center gap-3">
                            {playlist.cover ? (
                              <img
                                src={playlist.cover}
                                alt={playlist.name}
                                className="w-12 h-12 rounded object-cover"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded bg-zinc-700 flex items-center justify-center">
                                <svg className="w-6 h-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                </svg>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{playlist.name}</div>
                              {playlist.description && (
                                <div className="text-xs text-zinc-500 truncate">{playlist.description}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Playlist Songs */}
              <div className="md:col-span-2">
                {selectedUserPlaylist ? (
                  <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold">{selectedUserPlaylist.name}</h2>
                        {selectedUserPlaylist.description && (
                          <p className="text-sm text-zinc-400 mt-1">{selectedUserPlaylist.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handlePlayAllPlaylist}
                          disabled={userPlaylistSongs.length === 0 || loadingPlayAll}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                        >
                          {loadingPlayAll ? (
                            <>
                              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              加载中...
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              播放全部
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteUserPlaylist(selectedUserPlaylist.id)}
                          disabled={deletingPlaylistId !== null}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                        >
                          {deletingPlaylistId === selectedUserPlaylist.id ? (
                            <>
                              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              删除中...
                            </>
                          ) : (
                            '删除歌单'
                          )}
                        </button>
                      </div>
                    </div>

                    {loadingUserPlaylistSongs ? (
                      <div className="text-center py-8 text-zinc-400">加载中...</div>
                    ) : userPlaylistSongs.length === 0 ? (
                      <div className="text-center py-8 text-zinc-400">歌单为空</div>
                    ) : (
                      <div className="space-y-2">
                        {userPlaylistSongs.map((song, index) => (
                          <div
                            key={`${song.platform}+${song.id}`}
                            className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                          >
                            <div className="text-zinc-500 text-sm w-8 text-center">{index + 1}</div>
                            {song.pic && (
                              <img
                                src={song.pic}
                                alt={song.name}
                                className="w-12 h-12 rounded object-cover"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{song.name}</div>
                              <div className="text-sm text-zinc-400 truncate">{song.artist}</div>
                            </div>
                            <button
                              onClick={() => playSong(song, index)}
                              className="text-zinc-500 hover:text-green-500 transition-colors p-2"
                              title="播放"
                            >
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleRemoveSongFromUserPlaylist(song)}
                              className="text-zinc-500 hover:text-red-500 transition-colors p-2"
                              title="移除"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/10 h-full flex items-center justify-center">
                    <div className="text-center text-zinc-400">
                      <svg className="w-16 h-16 mx-auto mb-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                      <p>选择一个歌单查看详情</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Player */}
      {showPlayer && currentSong && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[95%] max-w-3xl z-50">
          <div className="bg-zinc-900/95 backdrop-blur-md rounded-xl p-4 border border-white/10 shadow-2xl">
            {/* Progress Bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 rounded-t-xl overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              <input
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={handleProgressChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-4 mt-2">
              {/* Song Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setShowLyrics(true)}
                >
                  {currentSong.pic ? (
                    <img
                      src={currentSong.pic}
                      alt={currentSong.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // 图片加载失败时显示默认图标
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <svg className="w-6 h-6 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">{currentSong.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{currentSong.artist}</div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4">
                <button onClick={playPrev} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button onClick={playNext} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2">
                  <input
                    type="range"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-16 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentSong) {
                      setSongToAddToPlaylist(currentSong);
                      setShowAddToPlaylistModal(true);
                    }
                  }}
                  className="text-zinc-500 hover:text-red-500 transition-colors"
                  title="添加到歌单"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
                <button
                  onClick={downloadSong}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="下载歌曲"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={toggleMode}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title={playMode === 'loop' ? '列表循环' : playMode === 'single' ? '单曲循环' : '随机播放'}
                >
                  {playMode === 'loop' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {playMode === 'single' && (
                    <div className="relative w-4 h-4">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">1</span>
                    </div>
                  )}
                  {playMode === 'random' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audio Element */}
      <audio ref={audioRef} className="hidden" />

      {/* Lyrics Modal */}
      {showLyrics && currentSong && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={(e) => {
            // 点击背景关闭音量条
            if (e.target === e.currentTarget) {
              setShowVolumeSlider(false);
            }
          }}
        >
          <div
            className="w-full max-w-2xl h-[90vh] md:h-auto max-h-[90vh] bg-zinc-900/95 rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col"
            onClick={() => setShowVolumeSlider(false)}
          >
            {/* Header */}
            <div className="relative h-32 md:h-48 bg-gradient-to-b from-zinc-800 to-zinc-900 shrink-0">
              {currentSong.pic && (
                <div className="absolute inset-0">
                  <img
                    src={currentSong.pic}
                    alt={currentSong.name}
                    className="w-full h-full object-cover opacity-30 blur-xl"
                  />
                </div>
              )}
              <div className="relative h-full flex flex-col items-center justify-center p-4 md:p-6">
                <button
                  onClick={() => setShowLyrics(false)}
                  className="absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl overflow-hidden shadow-2xl mb-2 md:mb-4">
                  {currentSong.pic ? (
                    <img
                      src={currentSong.pic}
                      alt={currentSong.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                      <svg className="w-8 h-8 md:w-12 md:h-12 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                      </svg>
                    </div>
                  )}
                </div>
                <h2 className="text-base md:text-xl font-bold text-white text-center mb-1 line-clamp-1">{currentSong.name}</h2>
                <p className="text-xs md:text-sm text-zinc-400 line-clamp-1">{currentSong.artist}</p>
              </div>
            </div>

            {/* Lyrics Content */}
            <div ref={lyricsContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6">
              {lyrics.length > 0 ? (
                <div className="space-y-4">
                  {lyrics.map((line, index) => (
                    <div
                      key={index}
                      data-index={index}
                      className={`text-center transition-all duration-300 ${
                        index === currentLyricIndex
                          ? 'text-white text-lg font-bold scale-110'
                          : index === currentLyricIndex - 1 || index === currentLyricIndex + 1
                          ? 'text-zinc-400 text-base'
                          : 'text-zinc-600 text-sm'
                      }`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center space-y-4">
                  <p className="text-zinc-500 text-sm">暂无歌词</p>
                  <p className="text-zinc-600 text-xs">纯音乐或歌词获取失败</p>
                </div>
              )}
            </div>

            {/* Mini Player Controls */}
            <div className="border-t border-white/5 p-3 md:p-4 shrink-0">
              {/* 上排：播放控制按钮 */}
              <div className="flex items-center justify-center gap-4 md:gap-6 mb-2 md:mb-3">
                <button onClick={playPrev} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 md:w-5 md:h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button onClick={playNext} className="text-zinc-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>
              </div>

              {/* 下排：其他按钮（小一号） */}
              <div className="flex items-center justify-center gap-3 md:gap-4 mb-2 md:mb-3">
                <button
                  onClick={() => setShowPlaylist(true)}
                  className="text-zinc-500 hover:text-white transition-colors relative"
                  title="播放列表"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  {playlist.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full text-[8px] flex items-center justify-center font-bold">
                      {playlist.length > 9 ? '9+' : playlist.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={downloadSong}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="下载歌曲"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowQualityMenu(true)}
                  className="px-2 py-0.5 rounded border text-amber-400 border-amber-500/50 bg-amber-900/20 text-[9px] md:text-[10px] font-mono min-w-[32px] text-center hover:bg-amber-900/30 transition-colors"
                  title="音质选择"
                >
                  {getQualityLabel()}
                </button>
                <button
                  onClick={toggleMode}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title={playMode === 'loop' ? '列表循环' : playMode === 'single' ? '单曲循环' : '随机播放'}
                >
                  {playMode === 'loop' && (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {playMode === 'single' && (
                    <div className="relative w-4 h-4 md:w-5 md:h-5">
                      <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[7px] md:text-[8px] font-bold">1</span>
                    </div>
                  )}
                  {playMode === 'random' && (
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                    </svg>
                  )}
                </button>
                {/* 音量控制 */}
                <div
                  className="relative"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowVolumeSlider(!showVolumeSlider);
                    }}
                    className="text-zinc-500 hover:text-white transition-colors"
                    title="音量"
                  >
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {/* 垂直音量条 - 桌面悬浮/移动端点击 */}
                  <div
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-2 transition-opacity ${showVolumeSlider ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="bg-zinc-800/95 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-white/10">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-zinc-400 font-mono">{volume}</span>
                        <div
                          className="h-24 w-6 bg-white/10 rounded-full relative cursor-pointer select-none"
                          onMouseDown={handleVolumeSliderInteraction}
                          onTouchStart={handleVolumeSliderInteraction}
                        >
                          <div
                            className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-full transition-all pointer-events-none"
                            style={{ height: `${volume}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* PiP 歌词按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePiPLyrics();
                  }}
                  className={`transition-colors ${
                    showPiPLyrics
                      ? 'text-green-500 hover:text-green-400'
                      : 'text-zinc-500 hover:text-white'
                  }`}
                  title={showPiPLyrics ? '关闭画中画歌词' : '画中画歌词'}
                  disabled={!currentSong}
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>
                  </svg>
                </button>
                {/* 添加到歌单按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentSong) {
                      setSongToAddToPlaylist(currentSong);
                      setShowAddToPlaylistModal(true);
                    }
                  }}
                  className="text-zinc-500 hover:text-red-500 transition-colors"
                  title="添加到歌单"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
              </div>

              {/* 进度条 */}
              <div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{formatTime(currentTime)}</span>
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-green-500 transition-all pointer-events-none"
                      style={{ width: `${progress}%` }}
                    />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={handleProgressChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Playlist Modal */}
      {showPlaylist && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl h-[90vh] md:h-auto max-h-[90vh] bg-zinc-900/95 rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="relative h-16 bg-gradient-to-b from-zinc-800 to-zinc-900 shrink-0 flex items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white">播放列表</h2>
                <span className="text-xs text-zinc-500">({playlist.length})</span>
              </div>
              <div className="flex items-center gap-2">
                {playlist.length > 0 && (
                  <button
                    onClick={async () => {
                      if (confirm('确定要清空全部播放记录吗？')) {
                        try {
                          await clearAllMusicPlayRecords();
                          setPlaylist([]);
                          setPlayRecords([]);
                          setPlaylistIndex(-1);
                        } catch (error) {
                          console.error('清空播放记录失败:', error);
                        }
                      }
                    }}
                    className="px-3 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors border border-red-500/50"
                    title="清空全部"
                  >
                    清空
                  </button>
                )}
                <button
                  onClick={() => setShowPlaylist(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Playlist */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              {playlist.length > 0 ? (
                <div className="space-y-2">
                  {playlist.map((song, index) => (
                    <div
                      key={`${song.id}-${index}`}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors group ${
                        index === playlistIndex
                          ? 'bg-green-500/20 border border-green-500/50'
                          : 'bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div
                        onClick={() => {
                          setPlaylistIndex(index);
                          playSong(song, -1);
                          setShowPlaylist(false);
                        }}
                        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                          {song.pic ? (
                            <img
                              src={song.pic}
                              alt={song.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate transition-colors ${
                            index === playlistIndex ? 'text-green-400' : 'text-white group-hover:text-green-400'
                          }`}>
                            {song.name}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">{song.artist}</div>
                        </div>
                        {index === playlistIndex ? (
                          <svg className="w-5 h-5 text-green-400 shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                          </svg>
                        )}
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const platform = song.platform || 'netease';
                            await deleteMusicPlayRecord(platform, song.id);

                            // 更新本地状态
                            const newPlaylist = playlist.filter((_, i) => i !== index);
                            const newRecords = playRecords.filter((_, i) => i !== index);
                            setPlaylist(newPlaylist);
                            setPlayRecords(newRecords);

                            // 如果删除的是当前播放的歌曲，调整索引
                            if (index === playlistIndex) {
                              setPlaylistIndex(-1);
                            } else if (index < playlistIndex) {
                              setPlaylistIndex(playlistIndex - 1);
                            }
                          } catch (error) {
                            console.error('删除播放记录失败:', error);
                          }
                        }}
                        className="w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        title="删除"
                      >
                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <svg className="w-16 h-16 text-zinc-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <p className="text-zinc-500 text-sm">播放列表为空</p>
                  <p className="text-zinc-600 text-xs mt-2">播放歌曲后会自动添加到列表</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quality Selection Menu */}
      {showQualityMenu && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end justify-center"
          onClick={() => setShowQualityMenu(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 rounded-t-2xl border-t border-white/10 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white text-center">选择音质</h3>
            </div>

            {/* Quality Options */}
            <div className="p-4 space-y-2">
              <button
                onClick={() => {
                  setQuality('128k');
                  setShowQualityMenu(false);
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === '128k'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === '128k' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">标准音质</div>
                    <div className="text-xs text-zinc-500">128kbps</div>
                  </div>
                </div>
                {quality === '128k' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  setQuality('320k');
                  setShowQualityMenu(false);
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === '320k'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === '320k' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">高品质 HQ</div>
                    <div className="text-xs text-zinc-500">320kbps</div>
                  </div>
                </div>
                {quality === '320k' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  setQuality('flac');
                  setShowQualityMenu(false);
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === 'flac'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === 'flac' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">无损音质 SQ</div>
                    <div className="text-xs text-zinc-500">FLAC</div>
                  </div>
                </div>
                {quality === 'flac' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  setQuality('flac24bit');
                  setShowQualityMenu(false);
                }}
                className={`w-full p-4 rounded-lg flex items-center justify-between transition-colors ${
                  quality === 'flac24bit'
                    ? 'bg-amber-500/20 border border-amber-500/50'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${quality === 'flac24bit' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div className="text-left">
                    <div className="text-white font-medium">Hi-Res音质 HR</div>
                    <div className="text-xs text-zinc-500">FLAC 24bit</div>
                  </div>
                </div>
                {quality === 'flac24bit' && (
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>

            {/* Cancel Button */}
            <div className="p-4 pt-0">
              <button
                onClick={() => setShowQualityMenu(false)}
                className="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Playlist Modal */}
      <AddToPlaylistModal
        song={songToAddToPlaylist}
        isOpen={showAddToPlaylistModal}
        onClose={() => {
          setShowAddToPlaylistModal(false);
          setSongToAddToPlaylist(null);
        }}
        onSuccess={() => {
          setToast({
            message: '已添加到歌单',
            type: 'success',
            onClose: () => setToast(null),
          });
        }}
        onError={(message) => {
          setToast({
            message,
            type: 'error',
            onClose: () => setToast(null),
          });
        }}
      />

      {/* Toast */}
      {toast && <Toast {...toast} />}

      {/* Confirm Modal */}
      {confirmModal.isOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={confirmModal.onCancel}
          >
            <div
              className="bg-zinc-900 rounded-xl max-w-md w-full border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">
                    {confirmModal.title}
                  </h3>
                  <button
                    onClick={confirmModal.onCancel}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-zinc-400">
                    {confirmModal.message}
                  </p>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={confirmModal.onCancel}
                    disabled={deletingPlaylistId !== null}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    disabled={deletingPlaylistId !== null}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {deletingPlaylistId !== null ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        删除中...
                      </>
                    ) : (
                      '确定'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* PiP Lyrics Window */}
      {showPiPLyrics && (
        <LyricsPiPWindow
          currentSong={currentSong}
          lyrics={lyrics}
          currentLyricIndex={currentLyricIndex}
          isPlaying={isPlaying}
          currentTime={currentTime}
          opacity={pipOpacity}
          minimized={pipMinimized}
          onOpacityChange={(opacity) => {
            setPipOpacity(opacity);
            localStorage.setItem('lyricsPiPOpacity', opacity.toString());
          }}
          onMinimizedChange={(minimized) => {
            setPipMinimized(minimized);
            localStorage.setItem('lyricsPiPMinimized', minimized.toString());
          }}
          onClose={() => setShowPiPLyrics(false)}
        />
      )}
      </>
    </div>
  );
}
