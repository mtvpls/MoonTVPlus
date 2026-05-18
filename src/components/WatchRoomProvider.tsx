// WatchRoom 全局状态管理 Provider
'use client';

import React, { createContext, useCallback,useContext, useEffect, useState } from 'react';

import { useWatchRoom } from '@/hooks/useWatchRoom';

import Toast, { ToastProps } from '@/components/Toast';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import type { ChatMessage, Member, Room, RoomType, ScreenState, WatchRoomConfig } from '@/types/watch-room';

// Import type from watch-room-socket
type WatchRoomSocket = import('@/lib/watch-room-socket').WatchRoomSocket;
const WATCH_ROOM_NO_CONNECT_KEY = 'watch_room_no_connect';
const WATCH_ROOM_SCREEN_PATH = '/watch-room/screen';

interface WatchRoomContextType {
  socket: WatchRoomSocket | null;
  isConnected: boolean;
  reconnectFailed: boolean;
  currentRoom: Room | null;
  members: Member[];
  chatMessages: ChatMessage[];
  isOwner: boolean;
  isEnabled: boolean;
  config: WatchRoomConfig | null;

  // 房间操作
  createRoom: (data: {
    name: string;
    description: string;
    password?: string;
    isPublic: boolean;
    roomType: RoomType;
    userName: string;
  }) => Promise<Room>;
  joinRoom: (data: {
    roomId: string;
    password?: string;
    userName: string;
    ownerToken?: string;
  }) => Promise<{ room: Room; members: Member[] }>;
  leaveRoom: () => void;
  getRoomList: () => Promise<Room[]>;

  // 聊天
  sendChatMessage: (content: string, type?: 'text' | 'emoji') => void;

  // 播放控制（供 play/live 页面使用）
  updatePlayState: (state: any) => void;
  seekPlayback: (currentTime: number) => void;
  play: () => void;
  pause: () => void;
  changeVideo: (state: any) => void;
  changeLiveChannel: (state: any) => void;
  startScreenShare: (state: ScreenState) => void;
  stopScreenShare: () => void;
  clearRoomState: () => void;

  // 重连
  manualReconnect: () => Promise<void>;
}

const WatchRoomContext = createContext<WatchRoomContextType | null>(null);

export const useWatchRoomContext = () => {
  const context = useContext(WatchRoomContext);
  if (!context) {
    throw new Error('useWatchRoomContext must be used within WatchRoomProvider');
  }
  return context;
};

// 安全版本，可以在非 Provider 内使用
export const useWatchRoomContextSafe = () => {
  return useContext(WatchRoomContext);
};

interface WatchRoomProviderProps {
  children: React.ReactNode;
}

export function WatchRoomProvider({ children }: WatchRoomProviderProps) {
  const [config, setConfig] = useState<WatchRoomConfig | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [shouldDisableWatchRoomConnection, setShouldDisableWatchRoomConnection] = useState<boolean | null>(null);

  // 处理房间删除的回调
  const handleRoomDeleted = useCallback((data?: { reason?: string }) => {
    console.log('[WatchRoomProvider] Room deleted:', data);

    // 显示Toast提示
    if (data?.reason === 'owner_left') {
      setToast({
        message: '房主已解散房间',
        type: 'error',
        duration: 4000,
        onClose: () => setToast(null),
      });
    } else {
      setToast({
        message: '房间已被删除',
        type: 'info',
        duration: 3000,
        onClose: () => setToast(null),
      });
    }
  }, []);

  // 处理房间状态清除的回调（房主离开超过30秒）
  const handleStateCleared = useCallback(() => {
    console.log('[WatchRoomProvider] Room state cleared');

    setToast({
      message: '房主已离开，播放状态已清除',
      type: 'info',
      duration: 4000,
      onClose: () => setToast(null),
    });
  }, []);

  const watchRoom = useWatchRoom(handleRoomDeleted, handleStateCleared);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setShouldDisableWatchRoomConnection(
      window.location.pathname !== WATCH_ROOM_SCREEN_PATH
      && window.localStorage.getItem(WATCH_ROOM_NO_CONNECT_KEY) === '1'
    );
  }, []);

  // 检查登录状态
  useEffect(() => {
    const checkLoginStatus = () => {
      const authInfo = getAuthInfoFromBrowserCookie();
      const loggedIn = !!(authInfo && authInfo.username);
      setIsLoggedIn(loggedIn);
    };

    // 初始检查
    checkLoginStatus();

    // 定期检查登录状态（每秒检查一次）
    const interval = setInterval(checkLoginStatus, 1000);

    return () => clearInterval(interval);
  }, []);

  // 手动重连
  const manualReconnect = useCallback(async () => {
    console.log('[WatchRoomProvider] Manual reconnect initiated');
    setReconnectFailed(false);

    const { watchRoomSocketManager } = await import('@/lib/watch-room-socket');
    const success = await watchRoomSocketManager.reconnect();

    if (success) {
      console.log('[WatchRoomProvider] Manual reconnect succeeded');
      // 尝试重新加入房间
      const storedInfo = localStorage.getItem('watch_room_info');
      if (storedInfo && watchRoom.socket) {
        try {
          const info = JSON.parse(storedInfo);
          console.log('[WatchRoomProvider] Attempting to rejoin room after reconnect');
          await watchRoom.joinRoom({
            roomId: info.roomId,
            password: info.password,
            userName: info.userName,
            ownerToken: info.ownerToken,
          });
        } catch (error) {
          console.error('[WatchRoomProvider] Failed to rejoin room after reconnect:', error);
        }
      }
    } else {
      console.error('[WatchRoomProvider] Manual reconnect failed');
      setReconnectFailed(true);
    }
  }, [watchRoom]);

  // 加载配置
  useEffect(() => {
    if (shouldDisableWatchRoomConnection === null) {
      return;
    }

    if (shouldDisableWatchRoomConnection) {
      setConfig({
        enabled: false,
        serverType: 'internal',
      });
      setIsEnabled(false);
      return;
    }

    const loadConfig = async () => {
      try {
        // 使用公共 API 获取观影室配置（不需要管理员权限）
        const response = await fetch('/api/server-config');
        if (response.ok) {
          const data = await response.json();
          // API 返回格式: { SiteName, StorageType, Version, WatchRoom }
          const watchRoomConfig: WatchRoomConfig = {
            enabled: data.WatchRoom?.enabled ?? false, // 默认不启用
            serverType: data.WatchRoom?.serverType ?? 'internal',
            externalServerUrl: data.WatchRoom?.externalServerUrl,
          };

          // 如果使用外部服务器，需要获取认证信息（需要登录）
          if (watchRoomConfig.serverType === 'external' && watchRoomConfig.enabled) {
            // 检查用户是否已登录
            if (!isLoggedIn) {
              console.log('[WatchRoom] User not logged in, skipping auth info request');
              // 用户未登录，不调用认证接口
            } else {
              try {
                const authResponse = await fetch('/api/watch-room-auth');
                if (authResponse.ok) {
                  const authData = await authResponse.json();
                  watchRoomConfig.externalServerAuth = authData.externalServerAuth;
                } else {
                  console.error('[WatchRoom] Failed to load auth info:', authResponse.status);
                  // 如果无法获取认证信息，禁用观影室
                  watchRoomConfig.enabled = false;
                }
              } catch (error) {
                console.error('[WatchRoom] Error loading auth info:', error);
                // 如果无法获取认证信息，禁用观影室
                watchRoomConfig.enabled = false;
              }
            }
          }

          setConfig(watchRoomConfig);
          setIsEnabled(watchRoomConfig.enabled);

          // 只在启用了观影室时才连接
          if (watchRoomConfig.enabled) {
            console.log('[WatchRoom] Connecting with config:', watchRoomConfig);

            // 设置重连回调
            const { watchRoomSocketManager } = await import('@/lib/watch-room-socket');
            watchRoomSocketManager.setReconnectFailedCallback(() => {
              console.log('[WatchRoomProvider] Reconnect failed callback triggered');
              setReconnectFailed(true);
            });

            watchRoomSocketManager.setReconnectSuccessCallback(() => {
              console.log('[WatchRoomProvider] Reconnect success callback triggered');
              setReconnectFailed(false);
            });

            await watchRoom.connect(watchRoomConfig);
          } else {
            console.log('[WatchRoom] Watch room is disabled, skipping connection');
          }
        } else {
          console.error('[WatchRoom] Failed to load config:', response.status);
          // 加载配置失败时，不连接，保持禁用状态
          const defaultConfig: WatchRoomConfig = {
            enabled: false,
            serverType: 'internal',
          };
          setConfig(defaultConfig);
          setIsEnabled(false);
        }
      } catch (error) {
        console.error('[WatchRoom] Error loading config:', error);
        // 加载配置失败时，不连接，保持禁用状态
        const defaultConfig: WatchRoomConfig = {
          enabled: false,
          serverType: 'internal',
        };
        setConfig(defaultConfig);
        setIsEnabled(false);
      }
    };

    loadConfig();
  }, [isLoggedIn, shouldDisableWatchRoomConnection]); // 添加 isLoggedIn 作为依赖

  // 仅在 Provider 卸载时断开，避免路由切换时误断开房间连接
  useEffect(() => {
    return () => {
      watchRoom.disconnect();
    };
  }, []);

  const contextValue: WatchRoomContextType = {
    socket: watchRoom.socket,
    isConnected: watchRoom.isConnected,
    reconnectFailed,
    currentRoom: watchRoom.currentRoom,
    members: watchRoom.members,
    chatMessages: watchRoom.chatMessages,
    isOwner: watchRoom.isOwner,
    isEnabled,
    config,
    createRoom: watchRoom.createRoom,
    joinRoom: watchRoom.joinRoom,
    leaveRoom: watchRoom.leaveRoom,
    getRoomList: watchRoom.getRoomList,
    sendChatMessage: watchRoom.sendChatMessage,
    updatePlayState: watchRoom.updatePlayState,
    seekPlayback: watchRoom.seekPlayback,
    play: watchRoom.play,
    pause: watchRoom.pause,
    changeVideo: watchRoom.changeVideo,
    changeLiveChannel: watchRoom.changeLiveChannel,
    startScreenShare: watchRoom.startScreenShare,
    stopScreenShare: watchRoom.stopScreenShare,
    clearRoomState: watchRoom.clearRoomState,
    manualReconnect,
  };

  return (
    <WatchRoomContext.Provider value={contextValue}>
      {children}
      {toast && <Toast {...toast} />}
    </WatchRoomContext.Provider>
  );
}
