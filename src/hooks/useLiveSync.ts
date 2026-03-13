// React Hook for Live Page Synchronization
'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';

import type { LiveState } from '@/types/watch-room';

interface UseLiveSyncOptions {
  currentChannelId: string;
  currentChannelName: string;
  currentChannelUrl: string;
  onChannelChange?: (channelId: string, channelUrl: string) => void;
}

export function useLiveSync({
  currentChannelId,
  currentChannelName,
  currentChannelUrl,
  onChannelChange,
}: UseLiveSyncOptions) {
  const watchRoom = useWatchRoomContextSafe();
  const syncingRef = useRef(false); // 防止循环同步

  // 检查是否在房间内
  const isInRoom = !!(watchRoom && watchRoom.currentRoom);
  const isOwner = watchRoom?.isOwner || false;
  const currentRoom = watchRoom?.currentRoom;
  const socket = watchRoom?.socket;

  // 房主：广播频道切换
  const broadcastChannelChange = useCallback(() => {
    if (!isOwner || !socket || syncingRef.current || !watchRoom) return;

    if (!currentChannelId || !currentChannelName || !currentChannelUrl) return;

    const state: LiveState = {
      type: 'live',
      channelId: currentChannelId,
      channelName: currentChannelName,
      channelUrl: currentChannelUrl,
    };

    console.log('[LiveSync] Broadcasting channel change:', state);
    watchRoom.changeLiveChannel(state);
  }, [
    isOwner,
    socket,
    currentChannelId,
    currentChannelName,
    currentChannelUrl,
    watchRoom,
  ]);

  // 房员：接收并同步房主的频道切换
  useEffect(() => {
    if (!socket || !currentRoom || isOwner || !isInRoom) return;

    const handleLiveChange = (state: LiveState) => {
      if (syncingRef.current) return;

      console.log('[LiveSync] Received channel change:', state);
      syncingRef.current = true;

      try {
        // 调用回调函数来切换频道
        if (onChannelChange) {
          onChannelChange(state.channelId, state.channelUrl);
        }
      } finally {
        setTimeout(() => {
          syncingRef.current = false;
        }, 1000);
      }
    };

    socket.on('live:change', handleLiveChange);

    return () => {
      socket.off('live:change', handleLiveChange);
    };
  }, [socket, currentRoom, isOwner, onChannelChange, isInRoom]);

  // 房主：当频道改变时自动广播
  useEffect(() => {
    if (!isOwner || !currentChannelId || !isInRoom) return;

    // 防止初始化时广播
    if (syncingRef.current) return;

    const timer = setTimeout(() => {
      broadcastChannelChange();
    }, 500); // 延迟广播，避免频繁触发

    return () => clearTimeout(timer);
  }, [
    isOwner,
    currentChannelId,
    currentChannelUrl,
    broadcastChannelChange,
    isInRoom,
  ]);

  return {
    isInRoom,
    isOwner,
    shouldDisableControls: isInRoom && !isOwner, // 房员禁用频道切换
    broadcastChannelChange, // 导出供手动调用
  };
}
