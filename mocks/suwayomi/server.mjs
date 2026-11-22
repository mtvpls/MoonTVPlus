import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { executeGraphql, getStats, MockError } from './catalog.mjs';
import { renderImage } from './images.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write('node server.mjs [--port 4568] [--host 127.0.0.1]\n');
  process.exit(0);
}

function argument(name, fallback) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`${name} 缺少参数`);
  return args[index + 1];
}

const port = Number(argument('--port', process.env.MANGA_MOCK_PORT || '4568'));
const host = argument('--host', process.env.MANGA_MOCK_HOST || '127.0.0.1');
const authMode = process.env.MANGA_MOCK_AUTH_MODE || 'none';
const username = process.env.MANGA_MOCK_USERNAME || 'demo';
const password = process.env.MANGA_MOCK_PASSWORD || 'demo';
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('端口必须在 0–65535 之间');
if (!['none', 'basic_auth', 'simple_login'].includes(authMode))
  throw new Error('MANGA_MOCK_AUTH_MODE 无效');

const sessions = new Map();
const stats = getStats();
const sourceResponseIntervalMs = 2000;
let sourceResponseQueue = Promise.resolve();

function send(
  response,
  status,
  body,
  contentType = 'application/json; charset=utf-8',
  head = false
) {
  const buffer = Buffer.from(
    typeof body === 'string' ? body : JSON.stringify(body)
  );
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': contentType.startsWith('image/')
      ? 'private, max-age=3600'
      : 'no-store',
  });
  response.end(head ? undefined : buffer);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new MockError('请求体超过 1 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function authorized(request) {
  if (authMode === 'none') return true;
  if (authMode === 'basic_auth')
    return (
      request.headers.authorization ===
      `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    );
  for (const [token, expiry] of sessions) {
    if (expiry <= Date.now()) sessions.delete(token);
  }
  const token = request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('mock_suwayomi_session='))
    ?.slice('mock_suwayomi_session='.length);
  return Boolean(token && sessions.has(token));
}

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, HEAD, POST, OPTIONS'
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url, 'http://mock.local');
    const head = request.method === 'HEAD';
    if (
      (url.pathname === '/' || url.pathname === '/health') &&
      ['GET', 'HEAD'].includes(request.method)
    ) {
      send(
        response,
        200,
        {
          service: 'Suwayomi Manga Mock',
          status: 'ok',
          authMode,
          sourceResponseIntervalMs,
          catalog: stats,
          graphql: '/api/graphql',
          sample: {
            sourceId: '1',
            mangaId: '10001',
            chapterId: '100010001',
            keyword: '恋人',
          },
        },
        undefined,
        head
      );
      return;
    }

    if (url.pathname === '/login.html' && request.method === 'POST') {
      const form = new URLSearchParams(await body(request));
      if (form.get('user') !== username || form.get('pass') !== password) {
        send(response, 401, { error: '用户名或密码错误' });
        return;
      }
      const token = randomUUID();
      sessions.set(token, Date.now() + 30 * 60 * 1000);
      response.writeHead(303, {
        'Set-Cookie': `mock_suwayomi_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
        Location: '/api/graphql',
      });
      response.end();
      return;
    }

    if (!authorized(request)) {
      if (authMode === 'basic_auth')
        response.setHeader('WWW-Authenticate', 'Basic realm="Suwayomi Mock"');
      send(response, 401, { error: 'Unauthorized' });
      return;
    }

    if (url.pathname === '/api/graphql' || url.pathname === '/graphql') {
      if (!['GET', 'POST'].includes(request.method)) {
        response.setHeader('Allow', 'GET, POST, OPTIONS');
        send(response, 405, { error: 'Method not allowed' });
        return;
      }
      let payload;
      try {
        payload =
          request.method === 'POST'
            ? JSON.parse(await body(request))
            : {
                query: url.searchParams.get('query'),
                variables: JSON.parse(
                  url.searchParams.get('variables') || '{}'
                ),
              };
      } catch {
        send(response, 400, {
          errors: [
            {
              message: '请求不是有效的 JSON',
              extensions: { code: 'BAD_USER_INPUT' },
            },
          ],
        });
        return;
      }
      try {
        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          (payload.variables !== undefined &&
            (!payload.variables ||
              typeof payload.variables !== 'object' ||
              Array.isArray(payload.variables)))
        )
          throw new MockError('GraphQL 请求格式无效');
        const result = executeGraphql(payload);
        if (result.data.fetchSourceManga) {
          sourceResponseQueue = sourceResponseQueue.then(() =>
            delay(sourceResponseIntervalMs)
          );
          await sourceResponseQueue;
        }
        send(response, 200, result);
      } catch (error) {
        send(response, 200, {
          errors: [
            {
              message: error.message,
              extensions: {
                code:
                  error instanceof MockError
                    ? error.code
                    : 'INTERNAL_SERVER_ERROR',
              },
            },
          ],
        });
      }
      return;
    }

    if (['GET', 'HEAD'].includes(request.method)) {
      const image = renderImage(url.pathname);
      if (image) {
        send(response, 200, image, 'image/svg+xml; charset=utf-8', head);
        return;
      }
    }
    send(response, 404, { error: 'Not found' }, undefined, head);
  } catch (error) {
    if (!response.destroyed && !response.writableEnded)
      send(
        response,
        error instanceof MockError && error.code === 'NOT_FOUND' ? 404 : 400,
        { error: error.message }
      );
  }
});

server.on('error', (error) => {
  process.stderr.write(
    (error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用，可用 --port 指定其他端口。`
      : error.message) + '\n'
  );
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const displayHost = host.includes(':') ? `[${host}]` : host;
  process.stdout.write(
    `漫画 Mock 已启动：http://${displayHost}:${address.port}\n`
  );
  process.stdout.write(
    `${stats.sources} 个来源 · ${stats.titles} 部漫画 · ${stats.editions} 个版本 · ${stats.chapters} 话\n`
  );
  process.stdout.write(
    'GraphQL: /api/graphql  健康检查: /health  按 Ctrl+C 停止\n'
  );
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
