#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
}

interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  'apple-mobile-web-app-capable': 'yes';
  'apple-mobile-web-app-status-bar-style': 'black';
  icons: ManifestIcon[];
}

export function generateManifest(): void {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const publicDir = path.join(projectRoot, 'public');
  const manifestPath = path.join(publicDir, 'manifest.json');
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTVPlus';

  const manifestTemplate: WebManifest = {
    name: siteName,
    short_name: siteName,
    description: '影视聚合',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black',
    icons: [
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-256x256.png', sizes: '256x256', type: 'image/png' },
      { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  };

  try {
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifestTemplate, null, 2));
    console.log(`✅ Generated manifest.json with site name: ${siteName}`);
  } catch (error) {
    console.error('❌ Error generating manifest.json:', error);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateManifest();
}