#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function loadLocalEnvFile() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (quote === '"') {
      value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    process.env[match[1]] = value;
  }
}

loadLocalEnvFile();

const runtimeEnvKeys = [
  'USERNAME',
  'PASSWORD',
  'NEXT_PUBLIC_STORAGE_TYPE',
  'UPSTASH_URL',
  'UPSTASH_TOKEN',
  'TMDB_API_KEY',
  'TMDB_IMAGE_DOMAIN',
  'NEXT_PUBLIC_SITE_NAME',
  'ANNOUNCEMENT',
  'ENABLE_REGISTER',
  'NEXT_PUBLIC_SEARCH_MAX_PAGE',
  'NEXT_PUBLIC_DOUBAN_PROXY_TYPE',
  'NEXT_PUBLIC_DOUBAN_PROXY',
  'NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE',
  'NEXT_PUBLIC_DOUBAN_IMAGE_PROXY',
  'NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD',
  'NEXT_PUBLIC_IMAGE_PROXY',
  'NEXT_PUBLIC_IMAGE_PROXY_PREFIX',
  'NEXT_PUBLIC_DISABLE_YELLOW_FILTER',
  'DISABLE_USER_FOLDER',
  'NEXT_PUBLIC_STORAGE_PREFIX',
  'NEXT_PUBLIC_ENABLE_STREAM_PROXY',
  'NEXT_PUBLIC_STREAM_PROXY_URL',
  'NEXT_PUBLIC_ENABLE_TURNSTILE',
  'TURNSTILE_SECRET_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NEXT_PUBLIC_THEME',
  'NEXT_PUBLIC_THEME_COLOR',
  'NEXT_PUBLIC_APP_URL',
  'ENABLE_TVBOX_SUBSCRIBE',
  'TVBOX_SUBSCRIBE_PATH',
  'TVBOX_SUBSCRIBE_TOKEN',
  'WATCH_ROOM_ENABLED',
  'WATCH_ROOM_WS_URL',
  'WATCH_ROOM_SERVER_URL',
  'WEBSOCKET_SECRET',
  'WEB_PUSH_EMAIL',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_BASEURL',
  'BAIDU_RELAY_URL',
  'NEXT_PUBLIC_BASE_PATH',
];

const edgeOneMiddlewareSkipPaths = [
  '/login',
  '/register',
  '/oidc-register',
  '/qr-login',
  '/warning',
  '/tv/login',
  '/api/login',
  '/api/register',
  '/api/logout',
  '/api/auth/oidc',
  '/api/auth/qr',
  '/api/auth/refresh',
  '/api/server-config',
  '/api/tvbox/subscribe',
];

function getRuntimeEnvLiteral() {
  const env = {};
  for (const key of runtimeEnvKeys) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return JSON.stringify(env);
}

function replaceEnvLiterals(code, envLiteral) {
  let output = '';
  let cursor = 0;
  let replaced = 0;
  const needle = 'env: {';

  while (true) {
    const start = code.indexOf(needle, cursor);
    if (start === -1) {
      output += code.slice(cursor);
      break;
    }

    let i = start + 'env: '.length;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; i < code.length; i += 1) {
      const char = code[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      console.warn('[edgeone-build] Unable to replace an env literal: malformed object');
      output += code.slice(cursor);
      break;
    }

    output += code.slice(cursor, start) + `env: ${envLiteral}`;
    cursor = i;
    replaced += 1;
  }

  if (replaced > 0) {
    console.log(`[edgeone-build] Replaced ${replaced} generated env literal(s) with filtered runtime env`);
  }

  return output;
}

function patchEdgeFunctionEnvInjection() {
  const edgeFunctionPath = join(process.cwd(), '.edgeone', 'edge-functions', 'index.js');
  let code;
  try {
    code = readFileSync(edgeFunctionPath, 'utf8');
  } catch {
    return;
  }

  const marker = '/* edgeone-process-env-injected */';
  const envLiteral = getRuntimeEnvLiteral();

  code = replaceEnvLiterals(code, envLiteral);

  const target = 'let request = context.request;';
  if (!code.includes(marker) && !code.includes(target)) {
    console.warn('[edgeone-build] Unable to patch edge function env injection: target not found');
  } else if (!code.includes(marker)) {
    code = code.replace(
      target,
      `${target}\n          ${marker}\n          if (typeof globalThis !== 'undefined' && globalThis.process?.env && context?.env) {\n            Object.assign(globalThis.process.env, context.env);\n          }`
    );
  }

  const middlewareSignature = 'async function executeMiddleware({request}) {';
  const middlewareMarker = '/* edgeone-middleware-env-injected */';
  if (!code.includes(middlewareMarker) && !code.includes(middlewareSignature)) {
    console.warn('[edgeone-build] Unable to patch middleware env injection: target not found');
  } else if (!code.includes(middlewareMarker)) {
    code = code.replace(
      middlewareSignature,
      `async function executeMiddleware({request, env}) {\n  ${middlewareMarker}\n  if (typeof globalThis !== 'undefined' && globalThis.process?.env && env) {\n    Object.assign(globalThis.process.env, env);\n  }`
    );
  }

  const matcherFallbackMarker = '/* edgeone-middleware-matcher-fallback */';
  const matcherFallbackTarget = `  if (!matchesPath(pathname, config.matcher)) {
    return null;
  }`;
  if (!code.includes(matcherFallbackMarker) && !code.includes(matcherFallbackTarget)) {
    console.warn('[edgeone-build] Unable to patch middleware matcher fallback: target not found');
  } else if (!code.includes(matcherFallbackMarker)) {
    code = code.replace(
      matcherFallbackTarget,
      `${matcherFallbackTarget}\n\n  ${matcherFallbackMarker}\n  const edgeOneMiddlewareSkipPaths = ${JSON.stringify(edgeOneMiddlewareSkipPaths)};\n  if (edgeOneMiddlewareSkipPaths.some((path) => pathname.startsWith(path))) {\n    return null;\n  }`
    );
  }

  writeFileSync(edgeFunctionPath, code);
  console.log('[edgeone-build] Patched edge function process.env injection');
}

const isInsideEdgeOneBuilder = process.env.NEXT_PRIVATE_STANDALONE === 'true';

const command = isInsideEdgeOneBuilder
  ? 'BUILD_TARGET=edgeone EDGEONE_PAGES=1 pnpm build'
  : 'BUILD_TARGET=edgeone EDGEONE_PAGES=1 edgeone makers build';

const child = spawn(command, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    BUILD_TARGET: 'edgeone',
    EDGEONE_PAGES: '1',
  },
});

child.on('exit', (code, signal) => {
  if (!signal && code === 0) {
    for (const file of ['edgeone.json', 'package.json']) {
      copyFileSync(join(process.cwd(), file), join(process.cwd(), '.edgeone', file));
    }

    patchEdgeFunctionEnvInjection();

    for (const envPath of [
      join(process.cwd(), '.edgeone', '.env'),
      join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node', '.env'),
    ]) {
      rmSync(envPath, { force: true });
    }
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
