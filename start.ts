#!/usr/bin/env node

import http from 'node:http';

import { generateManifest } from './scripts/generate-manifest';

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: 'production' });
}

function executeCronJob(): void {
  const cronPassword = process.env.CRON_PASSWORD || 'mtvpls';
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = process.env.PORT || '3000';
  const cronUrl = `http://${hostname}:${port}/api/cron/${cronPassword}`;

  console.log(`Executing cron job: ${cronUrl}`);

  const req = http.get(cronUrl, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
        return;
      }

      console.error('Cron job failed:', res.statusCode, data);
    });
  });

  req.on('error', (error) => {
    console.error('Error executing cron job:', error);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });
}

generateManifest();
await import('./server');

const hostname = process.env.HOSTNAME || 'localhost';
const port = process.env.PORT || '3000';
const targetUrl = `http://${hostname}:${port}/login`;

const intervalId = setInterval(() => {
  console.log(`Fetching ${targetUrl} ...`);

  const req = http.get(targetUrl, (res) => {
    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    console.log('Server is up, stop polling.');
    clearInterval(intervalId);

    setTimeout(() => {
      executeCronJob();
    }, 3000);

    setInterval(
      () => {
        executeCronJob();
      },
      60 * 60 * 1000,
    );
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });
}, 1000);
