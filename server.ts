import { createServer } from 'node:http';
import next from 'next';
import { parse } from 'node:url';

import { Server, type Socket } from 'socket.io';

import type {
  ChatMessage,
  ClientToServerEvents,
  Member,
  Room,
  RoomMemberInfo,
  ServerToClientEvents,
  WatchRoomConfig,
} from './src/types/watch-room';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedIoServer = Server<ClientToServerEvents, ServerToClientEvents>;

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function getWatchRoomConfig(): Promise<WatchRoomConfig> {
  const serverType = process.env.WATCH_ROOM_SERVER_TYPE === 'external' ? 'external' : 'internal';
  const config: WatchRoomConfig = {
    enabled: process.env.WATCH_ROOM_ENABLED === 'true',
    serverType,
    externalServerUrl: process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
    externalServerAuth: process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH,
  };

  console.log(`[WatchRoom] Watch room ${config.enabled ? 'enabled' : 'disabled'} via environment variable.`);
  return config;
}

class WatchRoomServer {
  private rooms = new Map<string, Room>();
  private members = new Map<string, Map<string, Member>>();
  private socketToRoom = new Map<string, RoomMemberInfo>();
  private roomDeletionTimers = new Map<string, NodeJS.Timeout>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private readonly io: TypedIoServer) {
    this.setupEventHandlers();
    this.startCleanupTimer();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: TypedSocket) => {
      console.log(`[WatchRoom] Client connected: ${socket.id}`);

      socket.on('room:create', (data, callback) => {
        try {
          const roomId = this.generateRoomId();
          const userId = socket.id;
          const ownerToken = this.generateRoomId();

          const room: Room = {
            id: roomId,
            name: data.name,
            description: data.description,
            password: data.password,
            isPublic: data.isPublic,
            ownerId: userId,
            ownerName: data.userName,
            ownerToken,
            memberCount: 1,
            currentState: null,
            createdAt: Date.now(),
            lastOwnerHeartbeat: Date.now(),
          };

          const member: Member = {
            id: userId,
            name: data.userName,
            isOwner: true,
            lastHeartbeat: Date.now(),
          };

          this.rooms.set(roomId, room);
          this.members.set(roomId, new Map([[userId, member]]));
          this.socketToRoom.set(socket.id, {
            roomId,
            userId,
            userName: data.userName,
            isOwner: true,
          });

          socket.join(roomId);

          console.log(`[WatchRoom] Room created: ${roomId} by ${data.userName}`);
          callback({ success: true, room });
        } catch (error) {
          console.error('[WatchRoom] Error creating room:', error);
          callback({ success: false, error: '创建房间失败' });
        }
      });

      socket.on('room:join', (data, callback) => {
        try {
          const room = this.rooms.get(data.roomId);
          if (!room) {
            callback({ success: false, error: '房间不存在' });
            return;
          }

          if (room.password && room.password !== data.password) {
            callback({ success: false, error: '密码错误' });
            return;
          }

          const userId = socket.id;
          let isOwner = false;

          if (data.ownerToken && data.ownerToken === room.ownerToken) {
            isOwner = true;
            room.ownerId = userId;
            room.lastOwnerHeartbeat = Date.now();
            this.rooms.set(data.roomId, room);
            console.log(`[WatchRoom] Owner ${data.userName} reconnected to room ${data.roomId}`);
          }

          const deletionTimer = this.roomDeletionTimers.get(data.roomId);
          if (deletionTimer) {
            console.log(`[WatchRoom] Cancelling deletion timer for room ${data.roomId}`);
            clearTimeout(deletionTimer);
            this.roomDeletionTimers.delete(data.roomId);
          }

          const member: Member = {
            id: userId,
            name: data.userName,
            isOwner,
            lastHeartbeat: Date.now(),
          };

          const roomMembers = this.members.get(data.roomId);
          if (roomMembers) {
            roomMembers.set(userId, member);
            room.memberCount = roomMembers.size;
            this.rooms.set(data.roomId, room);
          }

          this.socketToRoom.set(socket.id, {
            roomId: data.roomId,
            userId,
            userName: data.userName,
            isOwner,
          });

          socket.join(data.roomId);
          socket.to(data.roomId).emit('room:member-joined', member);

          console.log(`[WatchRoom] User ${data.userName} joined room ${data.roomId}${isOwner ? ' (as owner)' : ''}`);

          const members = Array.from(roomMembers?.values() || []);
          callback({ success: true, room, members });
        } catch (error) {
          console.error('[WatchRoom] Error joining room:', error);
          callback({ success: false, error: '加入房间失败' });
        }
      });

      socket.on('room:leave', () => {
        this.handleLeaveRoom(socket);
      });

      socket.on('room:list', (callback) => {
        const publicRooms = Array.from(this.rooms.values()).filter((room) => room.isPublic);
        callback(publicRooms);
      });

      socket.on('play:update', (state) => {
        console.log(`[WatchRoom] Received play:update from ${socket.id}:`, state);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:update');
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (!room) {
          console.log('[WatchRoom] Room not found for play:update');
          return;
        }

        room.currentState = state;
        this.rooms.set(roomInfo.roomId, room);
        console.log(`[WatchRoom] Broadcasting play:update to room ${roomInfo.roomId} from ${roomInfo.userName}`);
        socket.to(roomInfo.roomId).emit('play:update', state);
      });

      socket.on('play:seek', (currentTime) => {
        console.log(`[WatchRoom] Received play:seek from ${socket.id}:`, currentTime);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:seek');
          return;
        }

        console.log(`[WatchRoom] Broadcasting play:seek to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:seek', currentTime);
      });

      socket.on('play:play', () => {
        console.log(`[WatchRoom] Received play:play from ${socket.id}`);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:play');
          return;
        }

        console.log(`[WatchRoom] Broadcasting play:play to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:play');
      });

      socket.on('play:pause', () => {
        console.log(`[WatchRoom] Received play:pause from ${socket.id}`);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:pause');
          return;
        }

        console.log(`[WatchRoom] Broadcasting play:pause to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:pause');
      });

      socket.on('play:change', (state) => {
        console.log(`[WatchRoom] Received play:change from ${socket.id}:`, state);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:change');
          return;
        }

        if (!roomInfo.isOwner) {
          console.log('[WatchRoom] User is not owner, ignoring play:change');
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (!room) {
          console.log('[WatchRoom] Room not found for play:change');
          return;
        }

        room.currentState = state;
        this.rooms.set(roomInfo.roomId, room);
        console.log(`[WatchRoom] Broadcasting play:change to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:change', state);
      });

      socket.on('live:change', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) {
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (!room) {
          return;
        }

        room.currentState = state;
        this.rooms.set(roomInfo.roomId, room);
        socket.to(roomInfo.roomId).emit('live:change', state);
      });

      socket.on('chat:message', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          return;
        }

        const message: ChatMessage = {
          id: this.generateMessageId(),
          userId: roomInfo.userId,
          userName: roomInfo.userName,
          content: data.content,
          type: data.type,
          timestamp: Date.now(),
        };

        this.io.to(roomInfo.roomId).emit('chat:message', message);
      });

      socket.on('voice:offer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          return;
        }

        this.io.to(data.targetUserId).emit('voice:offer', {
          userId: socket.id,
          offer: data.offer,
        });
      });

      socket.on('voice:answer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          return;
        }

        this.io.to(data.targetUserId).emit('voice:answer', {
          userId: socket.id,
          answer: data.answer,
        });
      });

      socket.on('voice:ice', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          return;
        }

        this.io.to(data.targetUserId).emit('voice:ice', {
          userId: socket.id,
          candidate: data.candidate,
        });
      });

      socket.on('voice:audio-chunk', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          return;
        }

        socket.to(roomInfo.roomId).emit('voice:audio-chunk', {
          userId: socket.id,
          audioData: data.audioData,
          sampleRate: data.sampleRate || 16000,
        });
      });

      socket.on('heartbeat', () => {
        const roomInfo = this.socketToRoom.get(socket.id);

        if (roomInfo) {
          const roomMembers = this.members.get(roomInfo.roomId);
          const member = roomMembers?.get(roomInfo.userId);
          if (member) {
            member.lastHeartbeat = Date.now();
            roomMembers?.set(roomInfo.userId, member);
          }

          if (roomInfo.isOwner) {
            const room = this.rooms.get(roomInfo.roomId);
            if (room) {
              room.lastOwnerHeartbeat = Date.now();
              this.rooms.set(roomInfo.roomId, room);
            }
          }
        }

        socket.emit('heartbeat:pong', { timestamp: Date.now() });
      });

      socket.on('disconnect', () => {
        console.log(`[WatchRoom] Client disconnected: ${socket.id}`);
        this.handleLeaveRoom(socket);
      });
    });
  }

  private handleLeaveRoom(socket: TypedSocket): void {
    const roomInfo = this.socketToRoom.get(socket.id);
    if (!roomInfo) {
      return;
    }

    const { roomId, userId, isOwner } = roomInfo;
    const room = this.rooms.get(roomId);
    const roomMembers = this.members.get(roomId);

    if (roomMembers) {
      roomMembers.delete(userId);

      if (room) {
        room.memberCount = roomMembers.size;
        this.rooms.set(roomId, room);
      }

      socket.to(roomId).emit('room:member-left', userId);

      if (isOwner) {
        console.log(`[WatchRoom] Owner actively left room ${roomId}, disbanding room`);
        socket.to(roomId).emit('room:deleted', { reason: 'owner_left' });

        for (const memberId of roomMembers.keys()) {
          this.socketToRoom.delete(memberId);
        }

        this.deleteRoom(roomId, true);

        const deletionTimer = this.roomDeletionTimers.get(roomId);
        if (deletionTimer) {
          clearTimeout(deletionTimer);
          this.roomDeletionTimers.delete(roomId);
        }
      } else if (roomMembers.size === 0) {
        console.log(`[WatchRoom] Room ${roomId} is now empty, will delete in 30 seconds if no one rejoins`);

        const deletionTimer = setTimeout(() => {
          const currentRoomMembers = this.members.get(roomId);
          if (currentRoomMembers && currentRoomMembers.size === 0) {
            console.log(`[WatchRoom] Room ${roomId} deletion timer expired, deleting room`);
            this.deleteRoom(roomId);
            this.roomDeletionTimers.delete(roomId);
          }
        }, 30000);

        this.roomDeletionTimers.set(roomId, deletionTimer);
      }
    }

    socket.leave(roomId);
    this.socketToRoom.delete(socket.id);
  }

  private deleteRoom(roomId: string, skipNotify = false): void {
    console.log(`[WatchRoom] Deleting room ${roomId}`);

    if (!skipNotify) {
      this.io.to(roomId).emit('room:deleted');
    }

    this.rooms.delete(roomId);
    this.members.delete(roomId);
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const deleteTimeout = 5 * 60 * 1000;
      const clearStateTimeout = 30 * 1000;

      for (const [roomId, room] of this.rooms.entries()) {
        const timeSinceHeartbeat = now - room.lastOwnerHeartbeat;

        if (timeSinceHeartbeat > clearStateTimeout && room.currentState !== null) {
          console.log(`[WatchRoom] Room ${roomId} owner inactive for 30s, clearing play state`);
          room.currentState = null;
          this.rooms.set(roomId, room);
          this.io.to(roomId).emit('state:cleared');
        }

        if (timeSinceHeartbeat > deleteTimeout) {
          console.log(`[WatchRoom] Room ${roomId} owner timeout, deleting...`);
          this.deleteRoom(roomId);
        }
      }
    }, 10000);
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const timer of this.roomDeletionTimers.values()) {
      clearTimeout(timer);
    }
    this.roomDeletionTimers.clear();
  }
}

void app
  .prepare()
  .then(async () => {
    const httpServer = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url || '/', true);
        await handle(req, res, parsedUrl);
      } catch (error) {
        console.error('Error occurred handling', req.url, error);
        res.statusCode = 500;
        res.end('Internal server error');
      }
    });

    const watchRoomConfig = await getWatchRoomConfig();
    console.log('[WatchRoom] Config:', watchRoomConfig);

    let watchRoomServer: WatchRoomServer | null = null;

    if (watchRoomConfig.enabled && watchRoomConfig.serverType === 'internal') {
      console.log('[WatchRoom] Initializing Socket.IO server...');

      const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
        path: '/socket.io',
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
        },
      });

      watchRoomServer = new WatchRoomServer(io);
      console.log('[WatchRoom] Socket.IO server initialized');
    } else if (!watchRoomConfig.enabled) {
      console.log('[WatchRoom] Watch room is disabled');
    } else if (watchRoomConfig.serverType === 'external') {
      console.log('[WatchRoom] Using external watch room server');
    }

    httpServer
      .once('error', (error) => {
        console.error(error);
        process.exit(1);
      })
      .listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
        if (watchRoomConfig.enabled && watchRoomConfig.serverType === 'internal') {
          console.log(`> Socket.IO ready on ws://${hostname}:${port}`);
        }
      });

    const shutdown = (): void => {
      console.log('\n[Server] Shutting down...');
      watchRoomServer?.destroy();
      httpServer.close(() => {
        console.log('[Server] Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((error) => {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  });