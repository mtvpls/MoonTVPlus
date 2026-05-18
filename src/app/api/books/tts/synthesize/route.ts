import { NextRequest, NextResponse } from 'next/server';

import { getBookTtsConfig, synthesizeBookTts } from '@/lib/book-tts';

import { getAuthorizedBooksUsername } from '../../_utils';

export const runtime = 'nodejs';

type SynthesizePayload = {
  sourceId?: string;
  bookId?: string;
  chapterHref?: string;
  text?: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
};

export async function POST(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const config = await getBookTtsConfig();
    const payload = await request.json() as SynthesizePayload;
    if (!payload.sourceId?.trim() || !payload.bookId?.trim() || !payload.chapterHref?.trim()) {
      return NextResponse.json({ error: '缺少 sourceId / bookId / chapterHref' }, { status: 400 });
    }

    const result = await synthesizeBookTts({
      sourceId: payload.sourceId.trim(),
      bookId: payload.bookId.trim(),
      chapterHref: payload.chapterHref.trim(),
      text: payload.text?.trim() || '',
      voice: payload.voice?.trim() || config.defaultVoice,
      rate: payload.rate?.trim() || config.defaultRate,
      pitch: payload.pitch?.trim() || config.defaultPitch,
      volume: payload.volume?.trim() || config.defaultVolume,
    });

    return NextResponse.json({
      audioBase64: result.audioBuffer.toString('base64'),
      mimeType: result.mimeType,
      boundaries: result.boundaries,
      cacheKey: result.cacheKey,
      cacheHit: result.cacheHit,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || '语音合成失败' }, { status: 500 });
  }
}
