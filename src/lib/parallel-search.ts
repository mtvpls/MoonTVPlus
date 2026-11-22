export interface SearchContext {
  sessionId: string;
  model?: string;
  signal?: AbortSignal;
}

const ENDPOINT = 'https://search.parallel.ai/mcp';

/** The caller owns this context for one conversation or standalone research run. */
export function createSearchContext(
  sessionId?: string,
  model?: string,
  signal?: AbortSignal
): SearchContext {
  return {
    sessionId:
      typeof sessionId === 'string' &&
      sessionId &&
      /^[a-f0-9-]{32,36}$/i.test(sessionId)
        ? sessionId
        : crypto.randomUUID(),
    model,
    signal,
  };
}

interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

/** Bound both JSON and SSE responses; stop reading after the matching RPC result. */
async function readResponse(
  response: Response,
  id: number
): Promise<RpcResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty MCP response');
  const decoder = new TextDecoder();
  const sse = response.headers
    .get('content-type')
    ?.includes('text/event-stream');
  let buffer = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        size += value.byteLength;
        if (size > 300_000) throw new Error('MCP response too large');
        buffer += decoder.decode(value, { stream: true });
      }
      if (sse) {
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const message: RpcResponse = JSON.parse(data);
          if (message.id === id) return message;
        }
      } else if (done) {
        const message: RpcResponse = JSON.parse(buffer);
        if (message.id === id) return message;
      }
      if (done) throw new Error('Missing MCP result');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** A short-lived HTTP MCP connection; conversation identity is supplied separately. */
export async function callParallelSearch(
  name: 'web_search' | 'web_fetch',
  args: Record<string, unknown>,
  context: SearchContext
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (context.signal?.aborted) controller.abort();
  context.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'MoonTVPlus/0.1.0',
  };
  let nextId = 0;
  let mcpSession: string | null = null;
  const rpc = async (method: string, params?: Record<string, unknown>) => {
    const notification = method === 'notifications/initialized';
    const id = ++nextId;
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notification ? {} : { id }),
        method,
        params,
      }),
    });
    if (!response.ok) throw new Error('MCP HTTP error');
    if (method === 'initialize') {
      mcpSession = response.headers.get('mcp-session-id');
      if (mcpSession) headers['Mcp-Session-Id'] = mcpSession;
    }
    if (notification) {
      await response.body?.cancel();
      return {};
    }
    const message = await readResponse(response, id);
    if (message.error || !message.result) throw new Error('MCP RPC error');
    return message.result;
  };
  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'MoonTVPlus', version: '0.1.0' },
    });
    if (
      typeof initialized.protocolVersion !== 'string' ||
      !['2024-11-05', '2025-03-26', '2025-06-18'].includes(
        initialized.protocolVersion
      )
    ) {
      throw new Error('Unsupported MCP version');
    }
    headers['MCP-Protocol-Version'] = initialized.protocolVersion;
    await rpc('notifications/initialized');
    const listed = await rpc('tools/list');
    if (
      !Array.isArray(listed.tools) ||
      !listed.tools.some((tool) => tool?.name === name)
    ) {
      throw new Error('Parallel tool unavailable');
    }
    const result = await rpc('tools/call', {
      name,
      arguments: {
        ...args,
        session_id: context.sessionId,
        ...(context.model ? { model_name: context.model.slice(0, 100) } : {}),
      },
    });
    if (result.isError || !Array.isArray(result.content))
      throw new Error('Parallel tool failed');
    const text = result.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n');
    if (!text.trim()) throw new Error('Parallel returned no text');
    return text.slice(0, 25_000);
  } catch {
    if (context.signal?.aborted)
      throw new DOMException('请求已取消', 'AbortError');
    throw new Error(
      controller.signal.aborted
        ? 'Parallel 请求超时。'
        : 'Parallel 请求失败，请稍后重试。'
    );
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', abort);
    if (mcpSession && !controller.signal.aborted) {
      const closeController = new AbortController();
      const closeTimer = setTimeout(() => closeController.abort(), 2000);
      try {
        await fetch(ENDPOINT, {
          method: 'DELETE',
          headers,
          credentials: 'omit',
          redirect: 'error',
          signal: closeController.signal,
        })
          .then((response) => response.body?.cancel())
          .catch(() => undefined);
      } finally {
        clearTimeout(closeTimer);
      }
    }
  }
}
