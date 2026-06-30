import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getPan115PlayUrl } from '@/lib/netdisk/pan115.client';
import { getPan115NetdiskSession, refreshPan115NetdiskSession } from '@/lib/netdisk/pan115-session-cache';
import { resolvePan115Session } from '@/lib/netdisk/pan115-session-resolver';

export const runtime = process.env.EDGEONE_PAGES === '1' ? 'edge' : 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || searchParams.get('session');
    const episodeIndexRaw = searchParams.get('episodeIndex');
    const format = searchParams.get('format');
    if (!id || episodeIndexRaw == null) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const episodeIndex = Number.parseInt(episodeIndexRaw, 10);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
      return NextResponse.json({ error: '无效的 episodeIndex' }, { status: 400 });
    }

    refreshPan115NetdiskSession(id) || getPan115NetdiskSession(id);
    const { session, cookie } = await resolvePan115Session(id);
    const file = session.files[episodeIndex];
    if (!file) {
      return NextResponse.json({ error: '播放文件不存在' }, { status: 404 });
    }

    const url = await getPan115PlayUrl(file, cookie);
    refreshPan115NetdiskSession(id);

    // Check if file is .iso and we're on Docker (has ffmpeg)
    const isIso = file.name.toLowerCase().endsWith('.iso');
    const onDocker = process.env.DOCKER_ENV === 'true';

    if (isIso && onDocker && format === 'iso-stream') {
      // Stream ISO through ffmpeg — fetch the 115 CDN URL and pipe through ffmpeg
      try {
        const cdnResponse = await fetch(url);
        if (!cdnResponse.ok || !cdnResponse.body) {
          throw new Error(`CDN 返回 ${cdnResponse.status}`);
        }

        const reader = cdnResponse.body.getReader();
        const ffmpeg = spawn('ffmpeg', [
          '-i', 'pipe:0',
          '-map', '0:v:0',
          '-map', '0:a:0',
          '-c', 'copy',
          '-f', 'mp4',
          '-movflags', 'frag_keyframe+empty_moov',
          '-movflags', 'faststart',
          '-analyzeduration', '100000000',
          '-probesize', '100000000',
          'pipe:1',
        ], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Pipe CDN download to ffmpeg stdin
        const writable = ffmpeg.stdin;
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                writable.end();
                break;
              }
              writable.write(value);
            }
          } catch (err) {
            writable.destroy(err as Error);
          }
        };
        pump();

        // Collect ffmpeg stderr for debugging
        let stderr = '';
        ffmpeg.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        // Create a ReadableStream from ffmpeg stdout
        const stream = new ReadableStream({
          start(controller) {
            ffmpeg.stdout.on('data', (chunk: Buffer) => {
              controller.enqueue(chunk);
            });
            ffmpeg.stdout.on('end', () => {
              controller.close();
            });
            ffmpeg.stdout.on('error', (err) => {
              controller.error(err);
            });
          },
          cancel() {
            ffmpeg.kill();
            reader.cancel();
          },
        });

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'no-store',
            'Transfer-Encoding': 'chunked',
          },
        });
      } catch (streamErr) {
        const msg = streamErr instanceof Error ? streamErr.message : 'ISO 流式播放失败';
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    if (format === 'json') {
      return NextResponse.json({ url, headers: {} });
    }

    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取播放地址失败' },
      { status: 500 }
    );
  }
}