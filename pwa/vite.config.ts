import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// This repo is a Next.js app (not a Vite SPA). We use Vite only as a build-time
// tool to generate a Workbox-based Service Worker and a web manifest.
export default defineConfig({
  build: {
    // Emit SW + manifest into Next's static dir.
    outDir: '../public',
    emptyOutDir: false,
    // We don't need a real bundle; keep output predictable and isolated.
    assetsDir: 'pwa-assets',
    rollupOptions: {
      input: 'pwa/entry.ts',
      output: {
        entryFileNames: 'pwa-entry.js',
        chunkFileNames: 'pwa-assets/[name]-[hash].js',
        assetFileNames: 'pwa-assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    VitePWA({
      // Generate SW at build time.
      strategies: 'generateSW',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // Next.js will handle registration; keep VitePWA from injecting anything.
      injectRegister: null,

      // Generate a standard web manifest.
      manifest: {
        // Keep names configurable via env at build time.
        name: process.env.NEXT_PUBLIC_SITE_NAME || 'FoxAI',
        short_name: process.env.NEXT_PUBLIC_SITE_NAME || 'FoxAI',
        description: 'FoxAI 影视聚合平台 - 智能聚合，极致体验',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#9333ea',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          // Source image (1024x1024) lives in /public/foxaiTV.png
          {
            src: '/foxaiTV.png',
            sizes: '1024x1024',
            type: 'image/png',
          },
        ],
      },

      // We rely on runtime caching instead of precaching Next build output.
      // This avoids coupling SW generation to `.next/` structure.
      workbox: {
        globPatterns: [],
        runtimeCaching: [
          // Never cache streaming media.
          {
            urlPattern: /\.(m3u8|ts|m4s|mp4)(\?.*)?$/i,
            handler: 'NetworkOnly',
          },
          // Next static chunks.
          {
            urlPattern: /\/_next\/static\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'next-static',
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          // Images (basic heuristic).
          {
            urlPattern: /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)(\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
});
