/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any, simple-import-sort/imports */
// Web primitives must load before next/server in Jest 27.
import '@/__mocks__/web-globals';

import { webcrypto } from 'crypto';
import { writeFileSync } from 'fs';
import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

import { POST } from '@/app/api/ai/chat/route';

import { generateAIComments } from './ai-comment-generator';
import { buildAgentTools, runToolAgent } from './ai-tool-agent';
import { callParallelSearch, createSearchContext } from './parallel-search';
import { resolveWebSearch } from './web-search-config';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/permissions', () => ({ hasFeaturePermission: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/douban', () => ({ fetchDoubanData: jest.fn() }));
jest.mock('@/lib/tmdb.client', () => ({
  getNextApiKey: jest.fn(),
  getTMDBTrendingContent: jest.fn(),
  searchTMDBMulti: jest.fn(),
}));
jest.mock('@/lib/server/ssrf', () => ({
  validateProxyUrlServerSide: jest.fn(),
}));

const endpoint = 'https://search.parallel.ai/mcp';
const observed: any[] = [];
let failTool = false;
let useSse = false;
let modelTranscripts: any[][] = [];
const allModelTranscripts: any[][] = [];
const defaultModelCalls = [
  { name: 'web_search', args: { query: 'film release news' } },
  { name: 'fetch_page', args: { url: 'https://example.com/film?lang=zh' } },
  { name: 'web_search', args: { query: 'film sequel announcement' } },
];
let modelCalls = defaultModelCalls;
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
});
beforeEach(() => {
  failTool = false;
  useSse = false;
  modelTranscripts = [];
  modelCalls = defaultModelCalls;
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'fixture-user',
  });
  (hasFeaturePermission as jest.Mock).mockResolvedValue(true);
  (validateProxyUrlServerSide as jest.Mock).mockResolvedValue(true);
  (getConfig as jest.Mock).mockResolvedValue({
    AIConfig: {
      Enabled: true,
      EnableNewMode: true,
      EnableWebSearch: true,
      OpenAIApiKey: 'fixture-model-key',
      OpenAIBaseURL: 'https://model.example/v1',
      OpenAIModel: 'fixture-model',
      EnableStreaming: false,
    },
    SiteConfig: {},
  });
  global.fetch = jest.fn(async (input: any, init: any = {}) => {
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : {};
    const headers = new Headers(init.headers);
    if (url === endpoint) {
      observed.push({
        url,
        method: init.method,
        headers: Object.fromEntries(headers),
        body,
      });
      expect(headers.get('user-agent')).toBe('MoonTVPlus/0.1.0');
      expect(headers.has('authorization')).toBe(false);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1' },
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Mcp-Session-Id': 'connection-only',
            },
          }
        );
      }
      expect(headers.get('mcp-session-id')).toBe('connection-only');
      expect(headers.get('mcp-protocol-version')).toBe('2025-03-26');
      if (body.method === 'notifications/initialized')
        return new Response(null, { status: 202 });
      const result =
        body.method === 'tools/list'
          ? { tools: [{ name: 'web_search' }, { name: 'web_fetch' }] }
          : {
              isError: failTool,
              content: [
                {
                  type: 'text',
                  text:
                    body.params.name === 'web_search'
                      ? 'Film release news. Source: https://example.com/film?lang=zh'
                      : 'Full article: the film opens in December.',
                },
              ],
            };
      if (useSse) {
        const text =
          ': keepalive\r\n\r\ndata: ' +
          JSON.stringify({ method: 'notifications/progress' }) +
          '\r\n\r\nevent: message\r\ndata: ' +
          JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) +
          '\r\n\r\n';
        const bytes = new TextEncoder().encode(text);
        return new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7)
                controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        );
      }
      return response({ jsonrpc: '2.0', id: body.id, result });
    }
    if (url === 'https://model.example/v1/chat/completions') {
      modelTranscripts.push(body.messages);
      allModelTranscripts.push(body.messages);
      const completed = body.messages.filter(
        (m: any) => m.role === 'tool'
      ).length;
      const tool = modelCalls[completed];
      return response({
        choices: [
          {
            message: tool
              ? {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-' + completed,
                      type: 'function',
                      function: {
                        name: tool.name,
                        arguments: JSON.stringify(tool.args),
                      },
                    },
                  ],
                }
              : {
                  role: 'assistant',
                  content:
                    'The film opens in December, according to the article.',
                },
          },
        ],
      });
    }
    throw new Error('Unexpected destination: ' + url);
  }) as any;
});
afterAll(() => {
  if (process.env.PARALLEL_TRACE_PATH) {
    writeFileSync(
      process.env.PARALLEL_TRACE_PATH,
      JSON.stringify(
        { observed, modelTranscripts: allModelTranscripts },
        null,
        2
      )
    );
  }
});

async function chat(sessionId: string) {
  return POST(
    new NextRequest('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: 'When does the film open?',
        searchSessionId: sessionId,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

it('executes the normal route resolver and agent loop through search, fetch and follow-up consumption', async () => {
  const start = observed.length;
  const sessionId = 'a'.repeat(32);
  const result = await chat(sessionId);
  expect(result.status).toBe(200);
  expect((await result.json()).content).toContain('opens in December');
  expect(
    modelTranscripts[1].some(
      (m) =>
        m.role === 'tool' &&
        m.content.includes('https://example.com/film?lang=zh')
    )
  ).toBe(true);
  expect(
    modelTranscripts[2].some(
      (m) => m.role === 'tool' && m.content.includes('Full article')
    )
  ).toBe(true);
  const calls = observed
    .slice(start)
    .filter((r) => r.body.method === 'tools/call');
  expect(calls.map((r) => r.body.params.name)).toEqual([
    'web_search',
    'web_fetch',
    'web_search',
  ]);
  expect(
    calls.every((r) => r.body.params.arguments.session_id === sessionId)
  ).toBe(true);
  expect(
    calls.every((r) => r.body.params.arguments.model_name === 'fixture-model')
  ).toBe(true);
  expect(calls[1].body.params.arguments.urls).toEqual([
    'https://example.com/film?lang=zh',
  ]);
  expect(calls[0].body.params.arguments.search_queries).toEqual([
    'film release news',
  ]);
  await chat(sessionId); // another HTTP request in the same conversation
  expect(
    observed
      .filter((r) => r.body.method === 'tools/call')
      .slice(-3)
      .every((r) => r.body.params.arguments.session_id === sessionId)
  ).toBe(true);
});

it('keeps interleaved conversations separate and generates a new standalone run ID', async () => {
  const start = observed.length;
  await Promise.all([chat('b'.repeat(32)), chat('c'.repeat(32))]);
  const ids = new Set(
    observed
      .slice(start)
      .filter((r) => r.body.method === 'tools/call')
      .map((r) => r.body.params.arguments.session_id)
  );
  expect(ids).toEqual(new Set(['b'.repeat(32), 'c'.repeat(32)]));
  expect(createSearchContext().sessionId).not.toBe(
    createSearchContext().sessionId
  );
});

it('accepts SSE responses and retains one session on errors and retry', async () => {
  const context = createSearchContext();
  const start = observed.length;
  failTool = true;
  await expect(
    callParallelSearch(
      'web_search',
      { objective: 'film', search_queries: ['film'] },
      context
    )
  ).rejects.toThrow('Parallel 请求失败');
  failTool = false;
  useSse = true;
  await expect(
    callParallelSearch('web_fetch', { urls: ['https://example.com'] }, context)
  ).resolves.toContain('Full article');
  expect(
    observed
      .slice(start)
      .filter((r) => r.body.method === 'tools/call')
      .every((r) => r.body.params.arguments.session_id === context.sessionId)
  ).toBe(true);
});

it('enforces disabled search, permissions and safe URLs without making Parallel calls', async () => {
  const start = observed.length;
  (hasFeaturePermission as jest.Mock).mockResolvedValue(false);
  expect((await chat('d'.repeat(32))).status).toBe(403);
  expect(observed.length).toBe(start);
  const dataSources = {
    webSearch: resolveWebSearch({ EnableWebSearch: false }),
  };
  const tools = buildAgentTools(dataSources);
  expect(
    tools.some((t) => t.name === 'web_search' || t.name === 'fetch_page')
  ).toBe(false);
  const run = (message: string) =>
    runToolAgent({
      protocol: 'openai-completions',
      apiKey: 'fixture',
      baseURL: 'https://model.example/v1',
      model: 'fixture-model',
      streaming: false,
      systemPrompt: '',
      history: [],
      message,
      tools,
      dataSources,
    });
  await run('disabled');
  expect(observed.length).toBe(start);
  (validateProxyUrlServerSide as jest.Mock).mockResolvedValue(false);
  (hasFeaturePermission as jest.Mock).mockResolvedValue(true);
  await chat('e'.repeat(32));
  const calls = observed
    .slice(start)
    .filter((r) => r.body.method === 'tools/call');
  expect(calls.map((r) => r.body.params.name)).toEqual([
    'web_search',
    'web_search',
  ]);
  expect(validateProxyUrlServerSide).toHaveBeenCalledWith(
    'https://example.com/film?lang=zh'
  );
});

it('aborts slow transport requests on cancellation and timeout', async () => {
  global.fetch = jest.fn(
    (_input: any, init: any) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init.signal.aborted) abort();
        else init.signal.addEventListener('abort', abort, { once: true });
      })
  ) as any;
  const controller = new AbortController();
  const cancelled = callParallelSearch(
    'web_search',
    {},
    createSearchContext(undefined, undefined, controller.signal)
  );
  controller.abort();
  await expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
  jest.useFakeTimers();
  const timedOut = callParallelSearch('web_search', {}, createSearchContext());
  const assertion = expect(timedOut).rejects.toThrow('Parallel 请求超时');
  jest.advanceTimersByTime(15_000);
  await assertion;
  jest.useRealTimers();
});

it('retains configured keyed providers and never falls back after their explicit failure', async () => {
  const start = observed.length;
  const config = await getConfig();
  if (!config.AIConfig) throw new Error('Missing test AI configuration');
  config.AIConfig.TavilyApiKey = 'saved-tavily';
  config.AIConfig.WebSearchProvider = 'tavily';
  (getConfig as jest.Mock).mockResolvedValue(config);
  modelCalls = [defaultModelCalls[0]];
  const original = global.fetch;
  global.fetch = jest.fn(async (url: any, init: any) => {
    if (String(url) === 'https://api.tavily.com/search') {
      expect(JSON.parse(init.body).api_key).toBe('saved-tavily');
      return new Response(null, { status: 503 });
    }
    return original(url, init);
  }) as any;
  const errorLog = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    await chat('f'.repeat(32));
    expect(observed.length).toBe(start);
    expect(
      modelTranscripts[1].some(
        (m) => m.role === 'tool' && m.content.includes('无搜索结果')
      )
    ).toBe(true);
  } finally {
    errorLog.mockRestore();
  }
});

it.each([
  ['HTTP quota', () => new Response('quota exceeded', { status: 429 })],
  ['malformed JSON', () => response({ id: 1, result: null })],
  [
    'malformed SSE',
    () =>
      new Response('data: invalid\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  ],
  ['oversized body', () => new Response('x'.repeat(300001))],
])(
  'fails safely on %s without choosing another provider',
  async (_name, makeResponse) => {
    global.fetch = jest.fn(async () => makeResponse()) as any;
    await expect(
      callParallelSearch(
        'web_search',
        { objective: 'film', search_queries: ['film'] },
        createSearchContext()
      )
    ).rejects.toThrow('Parallel 请求失败');
    expect(
      (global.fetch as jest.Mock).mock.calls.every((c) => c[0] === endpoint)
    ).toBe(true);
  }
);

it('feeds anonymous Parallel results into the legacy comment generator', async () => {
  const original = global.fetch;
  global.fetch = jest.fn(async (url: any, init: any) => {
    if (String(url) === 'https://model.example/v1/chat/completions') {
      expect(
        JSON.parse(init.body).messages.some((m: any) =>
          m.content.includes('Film release news')
        )
      ).toBe(true);
      return response({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  content: 'An engaging film.',
                  rating: 4,
                  sentiment: 'positive',
                },
              ]),
            },
          },
        ],
      });
    }
    return original(url, init);
  }) as any;
  const results = await generateAIComments({
    movieName: 'Fixture Film',
    count: 1,
    protocol: 'openai-completions',
    apiKey: 'fixture-model-key',
    baseURL: 'https://model.example/v1',
    model: 'fixture-model',
    aiConfig: { EnableWebSearch: true, WebSearchProvider: 'parallel' },
  });
  expect(results[0].content).toBe('An engaging film.');
});
