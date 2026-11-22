import { toWebStream } from '@/lib/live-http';
import { rewriteTVBoxLiveM3U } from '@/lib/tvbox-live.shared';

/** 同源转发媒体；即使上游把 HLS 标为 text/plain，也会改写清单里的所有资源。 */
export async function relayTVBoxLiveResponse(
  response: Response,
  source: string,
  baseUrl: string
): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of ['content-type', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentLength = response.headers.get('content-length');
  if (!response.headers.get('content-encoding') && contentLength) {
    headers.set('Content-Length', contentLength);
  }
  const body = toWebStream(response.body);
  if (!body) return new Response(null, { status: response.status, headers });
  const reader = body.getReader();
  const initial: Uint8Array[] = [];
  let size = 0;
  let done = false;
  try {
    while (size < 16 && !done) {
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value) {
        initial.push(chunk.value);
        size += chunk.value.length;
      }
    }
    const prefix = new Uint8Array(size);
    let offset = 0;
    initial.forEach((chunk) => {
      prefix.set(chunk, offset);
      offset += chunk.length;
    });
    const decoder = new TextDecoder();
    const textStart = decoder
      .decode(prefix)
      .replace(/^\uFEFF/, '')
      .trimStart();
    if (textStart.startsWith('#EXTM3U') || textStart.startsWith('#EXTINF:')) {
      let content = decoder.decode(prefix, { stream: !done });
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value)
          content += decoder.decode(chunk.value, { stream: true });
      }
      content += decoder.decode();
      reader.releaseLock();
      headers.delete('Content-Length');
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      return new Response(rewriteTVBoxLiveM3U(content, baseUrl, source), {
        status: response.status,
        headers,
      });
    }
    // FLV、TS、AES key 等保持流式传输及 206/Range，取消播放时取消上游流。
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        initial.forEach((chunk) => controller.enqueue(chunk));
        if (done) {
          controller.close();
          reader.releaseLock();
        }
      },
      async pull(controller) {
        if (done) return;
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            done = true;
            controller.close();
            reader.releaseLock();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          done = true;
          controller.error(error);
          reader.releaseLock();
        }
      },
      async cancel(reason) {
        if (!done) {
          done = true;
          await reader.cancel(reason);
          reader.releaseLock();
        }
      },
    });
    return new Response(stream, { status: response.status, headers });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw error;
  }
}
