/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
const path = require('path');

// 检测是否为 Cloudflare Pages 构建
const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

const optimizedPackageImports = [
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@heroicons/react',
  'lucide-react',
  'react-icons',
];

const createNextConfig = (phase) => {
  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER || process.env.NODE_ENV === 'development';

  const nextConfig = {
  // Cloudflare Pages 不支持 standalone，使用默认输出
  output: isCloudflare ? undefined : 'standalone',
  eslint: {
    dirs: ['src'],
    // 在生产构建时忽略 ESLint 错误
    ignoreDuringBuilds: true,
  },

  reactStrictMode: false,
  swcMinify: true,

  experimental: {
    instrumentationHook: process.env.NODE_ENV === 'production' && !isCloudflare,
    optimizePackageImports: optimizedPackageImports,
    webpackBuildWorker: !isCloudflare,
  },

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config, { isServer }) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    // Cloudflare 使用 D1，不需要把 better-sqlite3 原生模块带入 Worker 产物。
    if (isCloudflare) {
      config.resolve.alias = {
        ...config.resolve.alias,
        ...Object.fromEntries(
          [
            'better-sqlite3',
            'sharp',
            'nodemailer',
            'socket.io',
            'redis',
            '@vercel/postgres',
            'pg',
          ].map((pkg) => [
            pkg,
            path.resolve(
              __dirname,
              'src/lib/cloudflare-shims/node-unsupported.ts'
            ),
          ])
        ),
        // Cloudflare Workers 有原生 fetch；代理 Agent 在 Workers 中不可用。
        // 用轻量 shim 替换 node-fetch / https-proxy-agent，避免把 Node HTTP 栈打入 Worker。
        'node-fetch': path.resolve(
          __dirname,
          'src/lib/cloudflare-shims/node-fetch.ts'
        ),
        'https-proxy-agent': path.resolve(
          __dirname,
          'src/lib/cloudflare-shims/https-proxy-agent.ts'
        ),
      };
      config.externals = (config.externals || []).filter((external) => {
        return !(
          external &&
          typeof external === 'object' &&
          Object.prototype.hasOwnProperty.call(external, 'better-sqlite3')
        );
      });
    }

    // Exclude better-sqlite3, D1, and Postgres modules from client-side bundle
    if (!isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
        '@vercel/postgres': 'commonjs @vercel/postgres',
        'pg': 'commonjs pg',
      });

      config.resolve.alias = {
        ...config.resolve.alias,
        'better-sqlite3': false,
        '@/lib/d1.db': false,
        '@/lib/d1-adapter': false,
        '@/lib/postgres.db': false,
        '@/lib/postgres-adapter': false,
      };
    }

    return config;
  },
};

  // next-pwa runs an additional webpack pass that is not needed for the
  // Cloudflare/OpenNext worker bundle and can make Cloudflare builds fail with
  // a generic "Build failed because of webpack errors" message.
  if (isDevelopment || isCloudflare) {
    return nextConfig;
  }

  const withPWA = require('next-pwa')({
    dest: 'public',
    register: true,
    skipWaiting: true,
    importScripts: ['/push-sw.js'],
  });

  return withPWA(nextConfig);
};

module.exports = createNextConfig;
