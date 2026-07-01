'use client';

import { useEffect } from 'react';

export interface UseMediaSessionOptions {
  title: string;
  artist?: string;
  album?: string;
  artwork?: Array<{ src: string; sizes?: string; type?: string }>;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: (seekOffset?: number) => void;
  onSeekForward?: (seekOffset?: number) => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
}

export function useMediaSession({
  title,
  artist,
  album,
  artwork,
  onPlay,
  onPause,
  onSeekBackward,
  onSeekForward,
  onPreviousTrack,
  onNextTrack,
}: UseMediaSessionOptions) {
  // 设置元数据
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || '',
      artist: artist || '',
      album: album || '',
      artwork: artwork || [],
    });
  }, [title, artist, album, artwork]);

  // 注册 play action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler('play', onPlay || null);
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
    };
  }, [onPlay]);

  // 注册 pause action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler('pause', onPause || null);
    return () => {
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [onPause]);

  // 注册 seekbackward action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler(
      'seekbackward',
      onSeekBackward
        ? (details) => onSeekBackward(details.seekOffset)
        : null,
    );
    return () => {
      navigator.mediaSession.setActionHandler('seekbackward', null);
    };
  }, [onSeekBackward]);

  // 注册 seekforward action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler(
      'seekforward',
      onSeekForward
        ? (details) => onSeekForward(details.seekOffset)
        : null,
    );
    return () => {
      navigator.mediaSession.setActionHandler('seekforward', null);
    };
  }, [onSeekForward]);

  // 注册 previoustrack action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler(
      'previoustrack',
      onPreviousTrack || null,
    );
    return () => {
      navigator.mediaSession.setActionHandler('previoustrack', null);
    };
  }, [onPreviousTrack]);

  // 注册 nexttrack action handler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler('nexttrack', onNextTrack || null);
    return () => {
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [onNextTrack]);
}
