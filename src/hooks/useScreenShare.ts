'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';

import type { ScreenState } from '@/types/watch-room';

const iceServers = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type ScreenShareQualityPreset = 'smooth' | 'hd' | 'ultra';

const SCREEN_SHARE_CONSTRAINTS: Record<
  ScreenShareQualityPreset,
  {
    label: string;
    frameRate: number;
    width: number;
    height: number;
  }
> = {
  smooth: {
    label: '流畅 720p / 15fps',
    frameRate: 15,
    width: 1280,
    height: 720,
  },
  hd: {
    label: '高清 1080p / 30fps',
    frameRate: 30,
    width: 1920,
    height: 1080,
  },
  ultra: {
    label: '超清 1440p / 30fps',
    frameRate: 30,
    width: 2560,
    height: 1440,
  },
};

export const screenShareQualityOptions = Object.entries(SCREEN_SHARE_CONSTRAINTS).map(
  ([value, preset]) => ({
    value: value as ScreenShareQualityPreset,
    label: preset.label,
  })
);

export interface ScreenShareCaptureSettings {
  width: number | null;
  height: number | null;
  frameRate: number | null;
}

export function useScreenShare(qualityPreset: ScreenShareQualityPreset = 'smooth') {
  const watchRoom = useWatchRoomContextSafe();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const stoppingRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [captureSettings, setCaptureSettings] = useState<ScreenShareCaptureSettings | null>(null);

  const currentRoom = watchRoom?.currentRoom || null;
  const socket = watchRoom?.socket || null;
  const isConnected = watchRoom?.isConnected || false;
  const isOwner = watchRoom?.isOwner || false;
  const members = watchRoom?.members || [];
  const currentState = currentRoom?.currentState;
  const isSharing = currentState?.type === 'screen' && currentState.status === 'sharing';

  const closePeerConnection = useCallback((userId: string) => {
    const pc = peerConnectionsRef.current.get(userId);
    if (!pc) return;

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peerConnectionsRef.current.delete(userId);
  }, []);

  const clearRemoteVideo = useCallback(() => {
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const cleanupSharingResources = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    peerConnectionsRef.current.forEach((_pc, userId) => closePeerConnection(userId));
    peerConnectionsRef.current.clear();

    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      displayStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setCaptureSettings(null);
    clearRemoteVideo();
    stoppingRef.current = false;
  }, [clearRemoteVideo, closePeerConnection]);

  const stopSharing = useCallback((notifyServer = true) => {
    cleanupSharingResources();

    if (notifyServer && isOwner) {
      watchRoom?.stopScreenShare();
    }
  }, [cleanupSharingResources, isOwner, watchRoom]);

  const createPeerConnection = useCallback((userId: string, ownerMode: boolean) => {
    const existing = peerConnectionsRef.current.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('screen:ice', {
          targetUserId: userId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    if (ownerMode && displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, displayStreamRef.current!);
      });
    } else {
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        remoteStreamRef.current = stream;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      };
    }

    peerConnectionsRef.current.set(userId, pc);
    return pc;
  }, [socket]);

  const sendOfferToMember = useCallback(async (memberId: string) => {
    if (!socket || !displayStreamRef.current) return;

    try {
      const pc = createPeerConnection(memberId, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('screen:offer', {
        targetUserId: memberId,
        offer,
      });
    } catch (err) {
      console.error('[ScreenShare] Failed to send offer:', err);
      setError('无法建立屏幕共享连接');
    }
  }, [createPeerConnection, socket]);

  const startSharing = useCallback(async () => {
    if (!watchRoom || !currentRoom || !isOwner) return;

    setIsStarting(true);
    setError(null);

    try {
      const constraints = SCREEN_SHARE_CONSTRAINTS[qualityPreset];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: constraints.frameRate,
          width: { ideal: constraints.width },
          height: { ideal: constraints.height },
        },
        audio: true,
      });

      displayStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        setCaptureSettings({
          width: typeof settings.width === 'number' ? settings.width : null,
          height: typeof settings.height === 'number' ? settings.height : null,
          frameRate: typeof settings.frameRate === 'number' ? settings.frameRate : null,
        });
        videoTrack.onended = () => {
          stopSharing(true);
        };
      }

      const state: ScreenState = {
        type: 'screen',
        status: 'sharing',
        ownerName: currentRoom.ownerName,
        hasAudio: stream.getAudioTracks().length > 0,
        startedAt: Date.now(),
      };

      watchRoom.startScreenShare(state);

      await Promise.all(
        members.filter((member) => !member.isOwner).map((member) => sendOfferToMember(member.id))
      );
    } catch (err: any) {
      console.error('[ScreenShare] Failed to start sharing:', err);
      setError(err?.message || '开启屏幕共享失败');
    } finally {
      setIsStarting(false);
    }
  }, [currentRoom, isOwner, members, qualityPreset, sendOfferToMember, stopSharing, watchRoom]);

  useEffect(() => {
    if (!socket || !currentRoom) return;

    const handleOffer = async (data: { userId: string; offer: RTCSessionDescriptionInit }) => {
      if (isOwner) return;

      try {
        const pc = createPeerConnection(data.userId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('screen:answer', {
          targetUserId: data.userId,
          answer,
        });
      } catch (err) {
        console.error('[ScreenShare] Failed to handle offer:', err);
        setError('接收共享画面失败');
      }
    };

    const handleAnswer = async (data: { userId: string; answer: RTCSessionDescriptionInit }) => {
      if (!isOwner) return;

      const pc = peerConnectionsRef.current.get(data.userId);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('[ScreenShare] Failed to handle answer:', err);
      }
    };

    const handleIce = async (data: { userId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnectionsRef.current.get(data.userId);
      if (!pc) return;

      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[ScreenShare] Failed to handle ICE:', err);
      }
    };

    const handleScreenStop = () => {
      if (!isOwner) {
        peerConnectionsRef.current.forEach((_pc, userId) => closePeerConnection(userId));
        peerConnectionsRef.current.clear();
        clearRemoteVideo();
      }
    };

    const handleSocketDisconnect = () => {
      if (!isOwner) {
        peerConnectionsRef.current.forEach((_pc, userId) => closePeerConnection(userId));
        peerConnectionsRef.current.clear();
        clearRemoteVideo();
      }
    };

    const handleViewerReady = (data: { userId: string }) => {
      if (!isOwner || !displayStreamRef.current) return;
      sendOfferToMember(data.userId);
    };

    socket.on('screen:offer', handleOffer);
    socket.on('screen:answer', handleAnswer);
    socket.on('screen:ice', handleIce);
    socket.on('screen:stop', handleScreenStop);
    socket.on('screen:viewer-ready', handleViewerReady);
    socket.on('disconnect', handleSocketDisconnect);

    return () => {
      socket.off('screen:offer', handleOffer);
      socket.off('screen:answer', handleAnswer);
      socket.off('screen:ice', handleIce);
      socket.off('screen:stop', handleScreenStop);
      socket.off('screen:viewer-ready', handleViewerReady);
      socket.off('disconnect', handleSocketDisconnect);
    };
  }, [clearRemoteVideo, closePeerConnection, createPeerConnection, currentRoom, isOwner, sendOfferToMember, socket]);

  useEffect(() => {
    if (!isOwner || !isSharing || !displayStreamRef.current) return;

    members
      .filter((member) => !member.isOwner)
      .forEach((member) => {
        if (!peerConnectionsRef.current.has(member.id)) {
          sendOfferToMember(member.id);
        }
      });

    Array.from(peerConnectionsRef.current.keys()).forEach((userId) => {
      const stillInRoom = members.some((member) => member.id === userId && !member.isOwner);
      if (!stillInRoom) {
        closePeerConnection(userId);
      }
    });
  }, [closePeerConnection, isOwner, isSharing, members, sendOfferToMember]);

  useEffect(() => {
    return () => {
      cleanupSharingResources();
    };
  }, [cleanupSharingResources]);

  useEffect(() => {
    if (!socket || !currentRoom || isOwner || !isConnected) return;
    if (currentState?.type !== 'screen' || currentState.status !== 'sharing') return;

    socket.emit('screen:viewer-ready');
  }, [currentRoom, currentState, isConnected, isOwner, socket]);

  return {
    currentRoom,
    isOwner,
    isSharing,
    isStarting,
    error,
    captureSettings,
    localVideoRef,
    remoteVideoRef,
    startSharing,
    stopSharing,
  };
}
