#!/usr/bin/env node

import { createServer } from 'node:http';

import { Server } from 'socket.io';

import { WatchRoomServer } from '../src/lib/watch-room-server';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../src/types/watch-room';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const authIndex = args.indexOf('--auth');
const port = Number.parseInt(
  portIndex >= 0 ? args[portIndex + 1] || '3001' : '3001',
  10,
);
const authKey = authIndex >= 0 ? args[authIndex + 1] || '' : '';

if (!authKey) {
  console.error('Error: --auth parameter is required');
  console.log(
    'Usage: tsx server/watch-room-standalone-server.ts --port 3001 --auth YOUR_SECRET_KEY',
  );
  process.exit(1);
}

const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  allowRequest: (req, callback) => {
    const auth = req.headers.authorization;
    if (auth === `Bearer ${authKey}`) {
      callback(null, true);
      return;
    }

    console.log('[WatchRoom] Unauthorized connection attempt');
    callback('Unauthorized', false);
  },
});

const watchRoomServer = new WatchRoomServer(io);

httpServer.listen(port, () => {
  console.log(`[WatchRoom] Standalone server running on port ${port}`);
  console.log(`[WatchRoom] Auth key: ${authKey.substring(0, 8)}...`);
});

const shutdown = (): void => {
  console.log('\n[WatchRoom] Shutting down...');
  watchRoomServer.destroy();
  httpServer.close(() => {
    console.log('[WatchRoom] Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
