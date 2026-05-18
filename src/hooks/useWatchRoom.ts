// React Hook for Watch Room
'use client';

import { useCallback, useEffect, useRef,useState } from 'react';

import { type WatchRoomSocket,watchRoomSocketManager } from '@/lib/watch-room-socket';

import type {
  ChatMessage,
  LiveState,
  Member,
  PlayState,
  Room,
  RoomType,
  ScreenState,
  StoredRoomInfo,
  WatchRoomConfig,
} from '@/types/watch-room';

const STORAGE_KEY = 'watch_room_info';

export function useWatchRoom(
  onRoomDeleted?: (data?: { reason?: string }) => void,
  onStateCleared?: () => void
) {
  const [socket, setSocket] = useState<WatchRoomSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rejoinInFlightRef = useRef(false);

  // 重新加入房间（自动重连）
  const rejoinRoom = useCallback(async (info: StoredRoomInfo) => {
    if (rejoinInFlightRef.current) {
      return;
    }

    rejoinInFlightRef.current = true;
    console.log('[WatchRoom] Auto-rejoining room:', info);
    try {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !watchRoomSocketManager.isConnected()) {
        console.error('[WatchRoom] Not connected, cannot rejoin');
        return;
      }

      const result = await new Promise<{ room: Room; members: Member[] }>((resolve, reject) => {
        sock.emit('room:join', {
          roomId: info.roomId,
          password: info.password,
          userName: info.userName,
          ownerToken: info.ownerToken, // 发送房主令牌
        }, (response) => {
          if (response.success && response.room && response.members) {
            resolve({ room: response.room, members: response.members });
          } else {
            reject(new Error(response.error || '重新加入房间失败'));
          }
        });
      });

      setCurrentRoom(result.room);
      setMembers(result.members);
      // 根据服务器返回的 room.ownerId 判断是否是房主
      setIsOwner(result.room.ownerId === sock.id);
      console.log('[WatchRoom] Successfully rejoined room:', result.room.name);
    } catch (error) {
      console.error('[WatchRoom] Failed to rejoin room:', error);
      clearStoredRoomInfo();
    } finally {
      rejoinInFlightRef.current = false;
    }
  }, []);

  const scheduleRejoin = useCallback((info: StoredRoomInfo, delay = 300) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      rejoinRoom(info);
    }, delay);
  }, [rejoinRoom]);

  // 连接到服务器
  const connect = useCallback(async (config: WatchRoomConfig) => {
    try {
      const sock = await watchRoomSocketManager.connect(config);
      setSocket(sock);
      setIsConnected(true);

      // 尝试自动重连房间
      const storedInfo = getStoredRoomInfo();
      if (storedInfo) {
        console.log('[WatchRoom] Attempting to reconnect to room:', storedInfo.roomId);
        scheduleRejoin(storedInfo);
      }
    } catch (error) {
      console.error('[WatchRoom] Failed to connect:', error);
      setIsConnected(false);
    }
  }, [scheduleRejoin]);

  // 断开连接
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    watchRoomSocketManager.disconnect();
    setSocket(null);
    setIsConnected(false);
    setCurrentRoom(null);
    setMembers([]);
    setChatMessages([]);
    setIsOwner(false);
  }, []);

  // 创建房间
  const createRoom = useCallback(
    async (data: { name: string; description: string; password?: string; isPublic: boolean; roomType: RoomType; userName: string }) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !watchRoomSocketManager.isConnected()) {
        throw new Error('Not connected');
      }

      return new Promise<Room>((resolve, reject) => {
        sock.emit('room:create', data, (response) => {
          if (response.success && response.room) {
            setCurrentRoom(response.room);
            setIsOwner(true);
            // 创建房间时，手动设置房主的成员信息
            setMembers([{
              id: sock.id!,
              name: data.userName,
              isOwner: true,
              lastHeartbeat: Date.now(),
            }]);
            storeRoomInfo({
              roomId: response.room.id,
              roomName: response.room.name,
              isOwner: true,
              userName: data.userName,
              password: data.password,
              ownerToken: response.room.ownerToken, // 保存房主令牌
              timestamp: Date.now(),
            });
            resolve(response.room);
          } else {
            reject(new Error(response.error || '创建房间失败'));
          }
        });
      });
    },
    []
  );

  // 加入房间
  const joinRoom = useCallback(
    async (data: { roomId: string; password?: string; userName: string; ownerToken?: string }) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !watchRoomSocketManager.isConnected()) {
        throw new Error('Not connected');
      }

      return new Promise<{ room: Room; members: Member[] }>((resolve, reject) => {
        sock.emit('room:join', data, (response) => {
          if (response.success && response.room && response.members) {
            setCurrentRoom(response.room);
            setMembers(response.members);
            // 根据服务器返回的 room.ownerId 判断是否是房主
            const isRoomOwner = response.room.ownerId === sock.id;
            setIsOwner(isRoomOwner);
            storeRoomInfo({
              roomId: response.room.id,
              roomName: response.room.name,
              isOwner: isRoomOwner,
              userName: data.userName,
              password: data.password,
              ownerToken: isRoomOwner ? (response.room.ownerToken || data.ownerToken) : undefined,
              timestamp: Date.now(),
            });
            resolve({ room: response.room, members: response.members });
          } else {
            reject(new Error(response.error || '加入房间失败'));
          }
        });
      });
    },
    []
  );

  // 离开房间
  const leaveRoom = useCallback(() => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock) return;

    sock.emit('room:leave');
    setCurrentRoom(null);
    setMembers([]);
    setChatMessages([]);
    setIsOwner(false);
    clearStoredRoomInfo();
  }, []);

  // 获取房间列表
  const getRoomList = useCallback(async (): Promise<Room[]> => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock || !watchRoomSocketManager.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve) => {
      sock.emit('room:list', (rooms) => {
        resolve(rooms);
      });
    });
  }, []);

  // 发送聊天消息
  const sendChatMessage = useCallback(
    (content: string, type: 'text' | 'emoji' = 'text') => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !currentRoom) return;

      sock.emit('chat:message', { content, type });
    },
    [currentRoom]
  );

  // 更新播放状态
  const updatePlayState = useCallback(
    (state: PlayState) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !isOwner) {
        console.log('[WatchRoom] Cannot update play state:', { hasSocket: !!sock, isOwner });
        return;
      }

      console.log('[WatchRoom] Emitting play:update with state:', state);
      sock.emit('play:update', state);
    },
    [isOwner]
  );

  // 跳转播放进度
  const seekPlayback = useCallback(
    (currentTime: number) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock) {
        console.log('[WatchRoom] Cannot seek - no socket');
        return;
      }

      console.log('[WatchRoom] Emitting play:seek with time:', currentTime);
      sock.emit('play:seek', currentTime);
    },
    []
  );

  // 播放
  const play = useCallback(() => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock) {
      console.log('[WatchRoom] Cannot play - no socket');
      return;
    }

    console.log('[WatchRoom] Emitting play:play');
    sock.emit('play:play');
  }, []);

  // 暂停
  const pause = useCallback(() => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock) {
      console.log('[WatchRoom] Cannot pause - no socket');
      return;
    }

    console.log('[WatchRoom] Emitting play:pause');
    sock.emit('play:pause');
  }, []);

  // 切换视频
  const changeVideo = useCallback(
    (state: PlayState) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock) {
        console.log('[WatchRoom] Cannot change video - no socket');
        return;
      }
      if (!isOwner) {
        console.log('[WatchRoom] Cannot change video - not owner');
        return;
      }

      console.log('[WatchRoom] Emitting play:change with state:', state);
      sock.emit('play:change', state);
    },
    [isOwner]
  );

  // 切换直播频道
  const changeLiveChannel = useCallback(
    (state: LiveState) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !isOwner) return;

      sock.emit('live:change', state);
    },
    [isOwner]
  );

  // 开始屏幕共享
  const startScreenShare = useCallback(
    (state: ScreenState) => {
      const sock = watchRoomSocketManager.getSocket();
      if (!sock || !isOwner) return;

      sock.emit('screen:start', state);
    },
    [isOwner]
  );

  // 停止屏幕共享
  const stopScreenShare = useCallback(() => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock || !isOwner) return;

    sock.emit('screen:stop');
  }, [isOwner]);

  // 清除房间播放状态（房主离开播放/直播页面时调用）
  const clearRoomState = useCallback(() => {
    const sock = watchRoomSocketManager.getSocket();
    if (!sock) {
      console.log('[WatchRoom] Cannot clear state - no socket');
      return;
    }
    if (!isOwner) {
      console.log('[WatchRoom] Cannot clear state - not owner');
      return;
    }

    console.log('[WatchRoom] Emitting state:clear');
    sock.emit('state:clear');
  }, [isOwner]);

  // 设置事件监听
  useEffect(() => {
    if (!socket) return;

    // 房间事件
    socket.on('room:joined', (data) => {
      setCurrentRoom(data.room);
      setMembers(data.members);
    });

    socket.on('room:member-joined', (member) => {
      setMembers((prev) => {
        const next = prev.filter((existing) => existing.id !== member.id);
        next.push(member);
        return next;
      });
    });

    socket.on('room:member-left', (userId) => {
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    });

    socket.on('room:deleted', (data?: { reason?: string }) => {
      console.log('[WatchRoom] Room deleted:', data);

      // 调用回调显示Toast
      onRoomDeleted?.(data);

      setCurrentRoom(null);
      setMembers([]);
      setChatMessages([]);
      clearStoredRoomInfo();
    });

    // 播放事件
    socket.on('play:update', (state) => {
      if (currentRoom) {
        setCurrentRoom((prev) => (prev ? { ...prev, currentState: state } : null));
      }
    });

    // 视频切换事件（换集、换源）
    socket.on('play:change', (state) => {
      if (currentRoom) {
        setCurrentRoom((prev) => (prev ? { ...prev, currentState: state } : null));
      }
    });

    // 直播频道切换事件
    socket.on('live:change', (state) => {
      if (currentRoom) {
        setCurrentRoom((prev) => (prev ? { ...prev, currentState: state } : null));
      }
    });

    // 屏幕共享事件
    socket.on('screen:start', (state) => {
      if (currentRoom) {
        setCurrentRoom((prev) => (prev ? { ...prev, currentState: state } : null));
      }
    });

    socket.on('screen:stop', () => {
      if (currentRoom) {
        setCurrentRoom((prev) => (prev ? { ...prev, currentState: null } : null));
      }
    });

    // 聊天事件
    socket.on('chat:message', (message) => {
      setChatMessages((prev) => [...prev, message]);
    });

    // 状态清除事件（房主心跳超时）
    socket.on('state:cleared', () => {
      console.log('[WatchRoom] Room state cleared by server (owner inactive)');

      // 清除当前房间的播放/直播状态
      setCurrentRoom((prev) => (prev ? { ...prev, currentState: null } : null));

      // 调用回调显示Toast
      onStateCleared?.();
    });

    // 连接状态
    socket.on('connect', () => {
      setIsConnected(true);
      const storedInfo = getStoredRoomInfo();
      if (storedInfo) {
        scheduleRejoin(storedInfo);
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socket.off('room:joined');
      socket.off('room:member-joined');
      socket.off('room:member-left');
      socket.off('room:deleted');
      socket.off('play:update');
      socket.off('play:change');
      socket.off('live:change');
      socket.off('screen:start');
      socket.off('screen:stop');
      socket.off('chat:message');
      socket.off('state:cleared');
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket, currentRoom, onRoomDeleted, onStateCleared, scheduleRejoin]);

  // 清理
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    socket,
    isConnected,
    currentRoom,
    members,
    chatMessages,
    isOwner,
    connect,
    disconnect,
    createRoom,
    joinRoom,
    leaveRoom,
    getRoomList,
    sendChatMessage,
    updatePlayState,
    seekPlayback,
    play,
    pause,
    changeVideo,
    changeLiveChannel,
    startScreenShare,
    stopScreenShare,
    clearRoomState,
  };
}

// 存储房间信息到 localStorage
function storeRoomInfo(info: StoredRoomInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
}

// 获取存储的房间信息
function getStoredRoomInfo(): StoredRoomInfo | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    const info: StoredRoomInfo = JSON.parse(stored);
    // 检查是否过期（24小时）
    if (Date.now() - info.timestamp > 24 * 60 * 60 * 1000) {
      clearStoredRoomInfo();
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

// 清除存储的房间信息
function clearStoredRoomInfo() {
  localStorage.removeItem(STORAGE_KEY);
}
