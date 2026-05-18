// Next.js 自定义服务器 + Socket.IO
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

function shouldInitSQLite() {
  const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
  return process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1' && !isCloudflare && process.env.MOONTV_LITE !== 'true';
}

function ensureSQLiteReady() {
  if (!shouldInitSQLite()) {
    return;
  }

  try {
    const { initSQLiteDatabase } = require('./scripts/init-sqlite.js');
    initSQLiteDatabase();
  } catch (error) {
    console.error('❌ Error initializing SQLite database:', error);
    throw error;
  }
}

ensureSQLiteReady();

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 读取观影室配置的辅助函数
async function getWatchRoomConfig() {
  // 观影室配置现在统一从环境变量读取
  const config = {
    enabled: process.env.WATCH_ROOM_ENABLED === 'true',
    serverType: (process.env.WATCH_ROOM_SERVER_TYPE || 'internal'),
    externalServerUrl: process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
    externalServerAuth: process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH,
  };

  console.log(`[WatchRoom] Watch room ${config.enabled ? 'enabled' : 'disabled'} via environment variable.`);
  return config;
}

// 观影室服务器类
class WatchRoomServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.members = new Map();
    this.socketToRoom = new Map();
    this.screenHelpers = new Map();
    this.helperToRoom = new Map();
    this.roomDeletionTimers = new Map(); // 房间延迟删除定时器
    this.cleanupInterval = null;
    this.setupEventHandlers();
    this.startCleanupTimer();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WatchRoom] Client connected: ${socket.id}`);

      // 创建房间
      socket.on('room:create', (data, callback) => {
        try {
          const roomId = this.generateRoomId();
          const userId = socket.id;
          const ownerToken = this.generateRoomId(); // 生成房主令牌

          const room = {
            id: roomId,
            name: data.name,
            description: data.description,
            password: data.password,
            isPublic: data.isPublic,
            roomType: data.roomType || 'sync',
            ownerId: userId,
            ownerName: data.userName,
            ownerToken: ownerToken, // 保存房主令牌
            memberCount: 1,
            currentState: null,
            createdAt: Date.now(),
            lastOwnerHeartbeat: Date.now(),
          };

          const member = {
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

      // 加入房间
      socket.on('room:join', (data, callback) => {
        try {
          const room = this.rooms.get(data.roomId);
          if (!room) {
            return callback({ success: false, error: '房间不存在' });
          }

          if (room.password && room.password !== data.password) {
            return callback({ success: false, error: '密码错误' });
          }

          const userId = socket.id;
          let isOwner = false;

          // 检查是否是房主重连（通过 ownerToken 验证）
          if (data.ownerToken && data.ownerToken === room.ownerToken) {
            isOwner = true;
            // 更新房主的 socket.id
            room.ownerId = userId;
            room.lastOwnerHeartbeat = Date.now();
            this.rooms.set(data.roomId, room);
            console.log(`[WatchRoom] Owner ${data.userName} reconnected to room ${data.roomId}`);
          }

          // 取消房间的删除定时器（如果有人重连）
          if (this.roomDeletionTimers.has(data.roomId)) {
            console.log(`[WatchRoom] Cancelling deletion timer for room ${data.roomId}`);
            clearTimeout(this.roomDeletionTimers.get(data.roomId));
            this.roomDeletionTimers.delete(data.roomId);
          }

          const member = {
            id: userId,
            name: data.userName,
            isOwner: isOwner,
            lastHeartbeat: Date.now(),
          };

          const roomMembers = this.members.get(data.roomId);
          if (roomMembers) {
            if (isOwner) {
              Array.from(roomMembers.entries()).forEach(([memberId, existingMember]) => {
                if (existingMember.isOwner && memberId !== userId) {
                  roomMembers.delete(memberId);
                }
              });
            }

            roomMembers.set(userId, member);
            room.memberCount = roomMembers.size;
            this.rooms.set(data.roomId, room);
          }

          this.socketToRoom.set(socket.id, {
            roomId: data.roomId,
            userId,
            userName: data.userName,
            isOwner: isOwner,
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

      // 离开房间
      socket.on('room:leave', () => {
        this.handleLeaveRoom(socket);
      });

      // 获取房间列表
      socket.on('room:list', (callback) => {
        const publicRooms = Array.from(this.rooms.values()).filter((room) => room.isPublic);
        callback(publicRooms);
      });

      // 播放状态更新（任何成员都可以触发同步）
      socket.on('play:update', (state) => {
        console.log(`[WatchRoom] Received play:update from ${socket.id}:`, state);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:update');
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          console.log(`[WatchRoom] Broadcasting play:update to room ${roomInfo.roomId} from ${roomInfo.userName}`);
          socket.to(roomInfo.roomId).emit('play:update', state);
        } else {
          console.log('[WatchRoom] Room not found for play:update');
        }
      });

      // 播放进度跳转
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

      // 播放
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

      // 暂停
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

      // 切换视频/集数
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
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          console.log(`[WatchRoom] Broadcasting play:change to room ${roomInfo.roomId}`);
          socket.to(roomInfo.roomId).emit('play:change', state);
        } else {
          console.log('[WatchRoom] Room not found for play:change');
        }
      });

      // 切换直播频道
      socket.on('live:change', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('live:change', state);
        }
      });

      socket.on('screen:helper-register', (data, callback) => {
        try {
          const room = this.rooms.get(data.roomId);
          if (!room) {
            callback({ success: false, error: '房间不存在' });
            return;
          }

          if (room.ownerToken !== data.ownerToken) {
            callback({ success: false, error: '房主身份验证失败' });
            return;
          }

          const oldHelperSocketId = this.screenHelpers.get(data.roomId);
          if (oldHelperSocketId && oldHelperSocketId !== socket.id) {
            this.helperToRoom.delete(oldHelperSocketId);
          }

          this.screenHelpers.set(data.roomId, socket.id);
          this.helperToRoom.set(socket.id, data.roomId);
          callback({ success: true });
        } catch (error) {
          console.error('[WatchRoom] Error registering screen helper:', error);
          callback({ success: false, error: '注册共享控制窗口失败' });
        }
      });

      // 开始屏幕共享
      socket.on('screen:start', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        const roomId = roomInfo?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socket.id) return;
        if (roomInfo && !roomInfo.isOwner) return;

        const room = this.rooms.get(roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomId, room);
          this.io.to(roomId).emit('screen:start', state);
        }
      });

      // 停止屏幕共享
      socket.on('screen:stop', () => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        const roomId = roomInfo?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socket.id) return;
        if (roomInfo && !roomInfo.isOwner) return;

        const room = this.rooms.get(roomId);
        if (room) {
          room.currentState = null;
          this.rooms.set(roomId, room);
          this.io.to(roomId).emit('screen:stop');
        }
      });

      socket.on('screen:viewer-ready', () => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (!room || roomInfo.isOwner || room.currentState?.type !== 'screen') return;

        const targetSocketId = this.screenHelpers.get(roomInfo.roomId) || room.ownerId;
        this.io.to(targetSocketId).emit('screen:viewer-ready', {
          userId: socket.id,
        });
      });

      // 屏幕共享 WebRTC 信令
      socket.on('screen:offer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:offer', {
          userId: socket.id,
          offer: data.offer,
        });
      });

      socket.on('screen:answer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:answer', {
          userId: socket.id,
          answer: data.answer,
        });
      });

      socket.on('screen:ice', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:ice', {
          userId: socket.id,
          candidate: data.candidate,
        });
      });

      // 聊天消息
      socket.on('chat:message', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        const message = {
          id: this.generateMessageId(),
          userId: roomInfo.userId,
          userName: roomInfo.userName,
          content: data.content,
          type: data.type,
          timestamp: Date.now(),
        };

        this.io.to(roomInfo.roomId).emit('chat:message', message);
      });

      // WebRTC 信令
      socket.on('voice:offer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:offer', {
          userId: socket.id,
          offer: data.offer,
        });
      });

      socket.on('voice:answer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:answer', {
          userId: socket.id,
          answer: data.answer,
        });
      });

      socket.on('voice:ice', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:ice', {
          userId: socket.id,
          candidate: data.candidate,
        });
      });

      // 语音聊天 - 服务器中转音频数据
      socket.on('voice:audio-chunk', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        // 将音频数据转发给房间内的其他成员
        socket.to(roomInfo.roomId).emit('voice:audio-chunk', {
          userId: socket.id,
          audioData: data.audioData,
          sampleRate: data.sampleRate || 16000,
        });
      });

      // 心跳
      socket.on('heartbeat', () => {
        const roomInfo = this.socketToRoom.get(socket.id);

        // 如果用户在房间中，更新心跳时间
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

        // 无论是否在房间中，都响应心跳包（pong）
        socket.emit('heartbeat:pong', { timestamp: Date.now() });
      });

      // 断开连接
      socket.on('disconnect', () => {
        console.log(`[WatchRoom] Client disconnected: ${socket.id}`);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (helperRoomId) {
          this.helperToRoom.delete(socket.id);
          if (this.screenHelpers.get(helperRoomId) === socket.id) {
            this.screenHelpers.delete(helperRoomId);
            const room = this.rooms.get(helperRoomId);
            if (room && room.currentState?.type === 'screen') {
              room.currentState = null;
              this.rooms.set(helperRoomId, room);
              this.io.to(helperRoomId).emit('screen:stop');
            }
          }
        }
        this.handleLeaveRoom(socket);
      });
    });
  }

  handleLeaveRoom(socket) {
    const roomInfo = this.socketToRoom.get(socket.id);
    if (!roomInfo) return;

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

      // 如果是房主主动离开，解散房间并踢出所有成员
      if (isOwner) {
        console.log(`[WatchRoom] Owner actively left room ${roomId}, disbanding room`);

        // 通知所有成员房间被解散
        socket.to(roomId).emit('room:deleted', { reason: 'owner_left' });

        // 强制所有成员离开房间
        const members = Array.from(roomMembers.keys());
        members.forEach(memberId => {
          this.socketToRoom.delete(memberId);
        });

        // 立即删除房间（跳过通知，因为上面已经发送了）
        this.deleteRoom(roomId, true);

        // 清除可能存在的删除定时器
        if (this.roomDeletionTimers.has(roomId)) {
          clearTimeout(this.roomDeletionTimers.get(roomId));
          this.roomDeletionTimers.delete(roomId);
        }
      } else {
        // 普通成员离开，房间为空时延迟删除
        if (roomMembers.size === 0) {
          console.log(`[WatchRoom] Room ${roomId} is now empty, will delete in 30 seconds if no one rejoins`);

          const deletionTimer = setTimeout(() => {
            // 再次检查房间是否仍然为空
            const currentRoomMembers = this.members.get(roomId);
            if (currentRoomMembers && currentRoomMembers.size === 0) {
              console.log(`[WatchRoom] Room ${roomId} deletion timer expired, deleting room`);
              this.deleteRoom(roomId);
              this.roomDeletionTimers.delete(roomId);
            }
          }, 30000); // 30秒后删除

          this.roomDeletionTimers.set(roomId, deletionTimer);
        }
      }
    }

    socket.leave(roomId);
    this.socketToRoom.delete(socket.id);
  }

  deleteRoom(roomId, skipNotify = false) {
    console.log(`[WatchRoom] Deleting room ${roomId}`);

    // 如果不跳过通知，则发送 room:deleted 事件
    if (!skipNotify) {
      this.io.to(roomId).emit('room:deleted');
    }

    this.rooms.delete(roomId);
    this.members.delete(roomId);
    const helperSocketId = this.screenHelpers.get(roomId);
    if (helperSocketId) {
      this.helperToRoom.delete(helperSocketId);
      this.screenHelpers.delete(roomId);
    }
  }

  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const deleteTimeout = 5 * 60 * 1000; // 5分钟 - 删除房间
      const clearStateTimeout = 30 * 1000; // 30秒 - 清除播放状态

      for (const [roomId, room] of this.rooms.entries()) {
        const timeSinceHeartbeat = now - room.lastOwnerHeartbeat;

        // 如果房主心跳超过30秒，清除播放状态
        if (timeSinceHeartbeat > clearStateTimeout && room.currentState !== null) {
          console.log(`[WatchRoom] Room ${roomId} owner inactive for 30s, clearing play state`);
          room.currentState = null;
          this.rooms.set(roomId, room);
          // 通知房间内所有成员状态已清除
          this.io.to(roomId).emit('state:cleared');
        }

        // 检查房主是否超时5分钟 - 删除房间
        if (timeSinceHeartbeat > deleteTimeout) {
          console.log(`[WatchRoom] Room ${roomId} owner timeout, deleting...`);
          this.deleteRoom(roomId);
        }
      }
    }, 10000); // 每10秒检查一次，确保更及时的清理
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // 清理所有房间删除定时器
    for (const timer of this.roomDeletionTimers.values()) {
      clearTimeout(timer);
    }
    this.roomDeletionTimers.clear();
  }
}

app.prepare().then(async () => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // 读取观影室配置
  const watchRoomConfig = await getWatchRoomConfig();
  console.log('[WatchRoom] Config:', watchRoomConfig);

  let watchRoomServer = null;

  // 只在启用观影室且使用内部服务器时初始化 Socket.IO
  if (watchRoomConfig.enabled && watchRoomConfig.serverType === 'internal') {
    console.log('[WatchRoom] Initializing Socket.IO server...');

    // 初始化 Socket.IO
    const io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    // 初始化观影室服务器
    watchRoomServer = new WatchRoomServer(io);
    console.log('[WatchRoom] Socket.IO server initialized');
  } else {
    if (!watchRoomConfig.enabled) {
      console.log('[WatchRoom] Watch room is disabled');
    } else if (watchRoomConfig.serverType === 'external') {
      console.log('[WatchRoom] Using external watch room server');
    }
  }

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      if (watchRoomConfig.enabled && watchRoomConfig.serverType === 'internal') {
        console.log(`> Socket.IO ready on ws://${hostname}:${port}`);
      }
    });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    if (watchRoomServer) {
      watchRoomServer.destroy();
    }
    httpServer.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[Server] Shutting down...');
    if (watchRoomServer) {
      watchRoomServer.destroy();
    }
    httpServer.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
  });
});
