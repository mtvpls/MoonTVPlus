// 观影室的 Durable Object 实现。
//
// 这是 server.js 里 WatchRoomServer 的搬运：把 Socket.IO 服务端换成本文件实现
// 的 engine.io/socket.io 协议层（见 ./socket-io-protocol），把 `io` / `socket` 换成
// 直接对 WebSocket 收发。
//
// 为什么是「一个 hub DO 装所有房间」而不是「每房间一个 DO」：客户端是先 io() 建连、
// 之后才 emit room:create / room:join，建连那一刻拿不到 roomId，Worker 层没法按房间
// 做 idFromName 路由。所以整个观影室共用一个 DO 实例，房间用 Map 区分。
//
// 为什么用非休眠的 accept()（而不是 ctx.acceptWebSocket）：连接在、DO 就常驻内存，
// 房间状态就能像原 server.js 一样只放内存，不用为每次 play:seek 写 storage。

import type { ChatMessage, Member, Room, RoomType } from '@/types/watch-room';

import { WebSocketPair } from './cf-runtime';
import type { CfWebSocket, DurableObjectState } from './cf-runtime';
import {
  EIO_MESSAGE,
  EIO_PING,
  EIO_PONG,
  SIO_CONNECT,
  SIO_DISCONNECT,
  SIO_EVENT,
  decodeEngineFrame,
  decodeSocketPacket,
  encodeAck,
  encodeConnectAck,
  encodeEvent,
  encodeOpen,
} from './socket-io-protocol';

const PING_INTERVAL_MS = 25_000; // engine.io 心跳间隔（v4 由服务端发 ping）
const PING_TIMEOUT_MS = 20_000;
const TICK_MS = 10_000; // 定时器节拍，替代原 setInterval(…, 10000)
const STATE_CLEAR_MS = 30_000; // 房主静默多久清空播放状态
const ROOM_DELETE_MS = 5 * 60_000; // 房主静默多久删房间
const EMPTY_ROOM_GRACE_MS = 30_000; // 空房间保留多久

interface SocketMeta {
  ws: CfWebSocket;
  userId: string;
}

interface SocketRoomInfo {
  roomId: string;
  userId: string;
  userName: string;
  isOwner: boolean;
}

interface ClientJoinData {
  roomId: string;
  password?: string;
  userName: string;
  ownerToken?: string;
}

interface ClientCreateData {
  name: string;
  description: string;
  password?: string;
  isPublic: boolean;
  roomType?: RoomType;
  userName: string;
}

interface SignalingData {
  targetUserId: string;
  offer?: unknown;
  answer?: unknown;
  candidate?: unknown;
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export class WatchRoomHub {
  private ctx: DurableObjectState;

  private rooms = new Map<string, Room>();
  private members = new Map<string, Map<string, Member>>();
  private sockets = new Map<string, SocketMeta>();
  private socketToRoom = new Map<string, SocketRoomInfo>();
  private screenHelpers = new Map<string, string>(); // roomId -> helper socketId
  private helperToRoom = new Map<string, string>(); // helper socketId -> roomId
  private emptyRoomDeleteAt = new Map<string, number>(); // roomId -> 到期时间戳

  private lastPingAt = Date.now();
  private seq = 0;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
  }

  // ---------------------------------------------------------------- 连接

  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      // 我们只实现 websocket 传输：客户端 transports 里 websocket 排在前面，实际不会走 polling
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const socketId = this.nextSocketId();
    this.sockets.set(socketId, { ws: server, userId: socketId });

    server.addEventListener('message', (event) => this.onMessage(socketId, event));
    server.addEventListener('close', () => this.onClose(socketId));
    server.addEventListener('error', () => this.onClose(socketId));

    // engine.io 握手必须先于一切
    this.send(server, encodeOpen(socketId, PING_INTERVAL_MS, PING_TIMEOUT_MS));
    this.scheduleTick();

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: CfWebSocket });
  }

  private onMessage(socketId: string, event: { data: unknown }): void {
    const meta = this.sockets.get(socketId);
    if (!meta) return;

    const raw = typeof event.data === 'string' ? event.data : '';
    if (!raw) return;

    const { eio, payload } = decodeEngineFrame(raw);

    if (eio === EIO_PONG) return;
    if (eio === EIO_PING) {
      this.send(meta.ws, '3');
      return;
    }
    if (eio !== EIO_MESSAGE) return;

    const packet = decodeSocketPacket(payload);
    if (!packet) return;

    if (packet.type === SIO_CONNECT) {
      this.send(meta.ws, encodeConnectAck(socketId));
      return;
    }
    if (packet.type === SIO_DISCONNECT) {
      this.handleLeaveRoom(socketId, true);
      return;
    }
    if (packet.type === SIO_EVENT) {
      const [eventName, ...args] = packet.data;
      if (typeof eventName === 'string') {
        this.dispatch(socketId, eventName, args, packet.id);
      }
    }
  }

  private onClose(socketId: string): void {
    const helperRoomId = this.helperToRoom.get(socketId);
    if (helperRoomId) {
      this.helperToRoom.delete(socketId);
      if (this.screenHelpers.get(helperRoomId) === socketId) {
        this.screenHelpers.delete(helperRoomId);
        const room = this.rooms.get(helperRoomId);
        if (room && room.currentState?.type === 'screen') {
          room.currentState = null;
          this.toRoom(helperRoomId, 'screen:stop', []);
        }
      }
    }

    this.handleLeaveRoom(socketId, false);
    this.sockets.delete(socketId);
    this.scheduleTick();
  }

  // ---------------------------------------------------------------- 事件分发

  private dispatch(socketId: string, event: string, args: unknown[], ackId?: number): void {
    const meta = this.sockets.get(socketId);
    if (!meta) return;

    const ack = (payload: unknown): void => {
      if (ackId !== undefined) {
        this.send(meta.ws, encodeAck(ackId, [payload]));
      }
    };
    const info = this.socketToRoom.get(socketId);

    switch (event) {
      case 'room:create': {
        const data = (args[0] || {}) as ClientCreateData;
        const roomId = generateRoomId();
        const room: Room = {
          id: roomId,
          name: data.name,
          description: data.description,
          password: data.password,
          isPublic: data.isPublic,
          roomType: data.roomType || 'sync',
          ownerId: socketId,
          ownerName: data.userName,
          ownerToken: generateRoomId(),
          memberCount: 1,
          currentState: null,
          createdAt: Date.now(),
          lastOwnerHeartbeat: Date.now(),
        };
        const member: Member = {
          id: socketId,
          name: data.userName,
          isOwner: true,
          lastHeartbeat: Date.now(),
        };
        this.rooms.set(roomId, room);
        this.members.set(roomId, new Map([[socketId, member]]));
        this.socketToRoom.set(socketId, {
          roomId,
          userId: socketId,
          userName: data.userName,
          isOwner: true,
        });
        ack({ success: true, room });
        break;
      }

      case 'room:join': {
        const data = (args[0] || {}) as ClientJoinData;
        const room = this.rooms.get(data.roomId);
        if (!room) {
          ack({ success: false, error: '房间不存在' });
          return;
        }
        if (room.password && room.password !== data.password) {
          ack({ success: false, error: '密码错误' });
          return;
        }

        // 房主凭 ownerToken 重连：接管房主身份
        let isOwner = false;
        if (data.ownerToken && data.ownerToken === room.ownerToken) {
          isOwner = true;
          room.ownerId = socketId;
          room.lastOwnerHeartbeat = Date.now();
        }
        // 房主本人走邀请链接（没带令牌）：拒绝，避免以房员身份进来
        if (!isOwner && data.userName && data.userName === room.ownerName) {
          ack({ success: false, error: '你是该房间房主，无法通过邀请链接加入' });
          return;
        }

        // 有人回来，取消空房间的延迟删除
        this.emptyRoomDeleteAt.delete(data.roomId);

        const member: Member = {
          id: socketId,
          name: data.userName,
          isOwner,
          lastHeartbeat: Date.now(),
        };
        const roomMembers = this.members.get(data.roomId);
        if (roomMembers) {
          if (isOwner) {
            // 快照后再删，避免边遍历边改 Map
            for (const [memberId, existing] of Array.from(roomMembers)) {
              if (existing.isOwner && memberId !== socketId) {
                roomMembers.delete(memberId);
              }
            }
          }
          roomMembers.set(socketId, member);
          room.memberCount = roomMembers.size;
        }

        this.socketToRoom.set(socketId, {
          roomId: data.roomId,
          userId: socketId,
          userName: data.userName,
          isOwner,
        });

        this.toRoom(data.roomId, 'room:member-joined', [member], socketId);
        ack({
          success: true,
          room,
          members: Array.from(roomMembers?.values() || []),
        });
        break;
      }

      case 'room:leave':
        this.handleLeaveRoom(socketId, true);
        break;

      case 'room:list': {
        const publicRooms = Array.from(this.rooms.values()).filter((room) => room.isPublic);
        ack(publicRooms);
        break;
      }

      case 'play:update': {
        if (!info?.isOwner) return;
        this.applyState(info.roomId, args[0] as Room['currentState']);
        this.toRoom(info.roomId, 'play:update', [args[0]], socketId);
        break;
      }

      case 'play:seek': {
        if (!info?.isOwner) return;
        this.toRoom(info.roomId, 'play:seek', [args[0]], socketId);
        break;
      }

      case 'play:play': {
        if (!info?.isOwner) return;
        this.toRoom(info.roomId, 'play:play', [], socketId);
        break;
      }

      case 'play:pause': {
        if (!info?.isOwner) return;
        this.toRoom(info.roomId, 'play:pause', [], socketId);
        break;
      }

      case 'play:change': {
        if (!info?.isOwner) return;
        this.applyState(info.roomId, args[0] as Room['currentState']);
        this.toRoom(info.roomId, 'play:change', [args[0]], socketId);
        break;
      }

      // 房主离开播放页（SPA 导航，连接还在）：通知房员暂停，不清 currentState
      case 'play:owner-leave': {
        if (!info?.isOwner) return;
        this.toRoom(info.roomId, 'play:owner-left', [], socketId);
        break;
      }

      case 'live:change': {
        if (!info?.isOwner) return;
        this.applyState(info.roomId, args[0] as Room['currentState']);
        this.toRoom(info.roomId, 'live:change', [args[0]], socketId);
        break;
      }

      case 'music:change':
      case 'music:update':
      case 'music:queue':
      case 'music:play':
      case 'music:pause':
      case 'music:seek': {
        if (!info?.isOwner) return;
        const room = this.rooms.get(info.roomId);
        if (room?.roomType !== 'music') return;

        // 只有 play/pause 会在 currentState 里翻转 isPlaying，但广播出去的始终是原始 state
        let state = (args[0] || {}) as Record<string, unknown>;
        if (event === 'music:play') state = { ...state, isPlaying: true };
        if (event === 'music:pause') state = { ...state, isPlaying: false };
        room.currentState = state as unknown as Room['currentState'];
        this.toRoom(info.roomId, event, [args[0]], socketId);
        break;
      }

      case 'screen:helper-register': {
        const data = (args[0] || {}) as { roomId: string; ownerToken: string };
        const room = this.rooms.get(data.roomId);
        if (!room) {
          ack({ success: false, error: '房间不存在' });
          return;
        }
        if (room.ownerToken !== data.ownerToken) {
          ack({ success: false, error: '房主身份验证失败' });
          return;
        }

        const oldHelper = this.screenHelpers.get(data.roomId);
        if (oldHelper && oldHelper !== socketId) {
          this.helperToRoom.delete(oldHelper);
        }
        this.screenHelpers.set(data.roomId, socketId);
        this.helperToRoom.set(socketId, data.roomId);
        ack({ success: true });
        break;
      }

      // 共享控制窗口（helper）不在房间成员里，所以消息来源可能是 helper 也可能是房主
      case 'screen:start': {
        const helperRoomId = this.helperToRoom.get(socketId);
        const roomId = info?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socketId) return;
        if (info && !info.isOwner) return;

        this.applyState(roomId, args[0] as Room['currentState']);
        this.toRoom(roomId, 'screen:start', [args[0]]);
        break;
      }

      case 'screen:stop': {
        const helperRoomId = this.helperToRoom.get(socketId);
        const roomId = info?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socketId) return;
        if (info && !info.isOwner) return;

        this.applyState(roomId, null);
        this.toRoom(roomId, 'screen:stop', []);
        break;
      }

      case 'screen:viewer-ready': {
        if (!info) return;
        const room = this.rooms.get(info.roomId);
        if (!room || info.isOwner || room.currentState?.type !== 'screen') return;

        const target = this.screenHelpers.get(info.roomId) || room.ownerId;
        this.toSocket(target, 'screen:viewer-ready', [{ userId: socketId }]);
        break;
      }

      // 屏幕共享 WebRTC 信令：单纯转发到目标连接
      case 'screen:offer':
      case 'screen:answer':
      case 'screen:ice': {
        const data = (args[0] || {}) as SignalingData;
        if (!info && !this.helperToRoom.get(socketId)) return;
        this.toSocket(data.targetUserId, event, [this.signalingPayload(event, socketId, data)]);
        break;
      }

      case 'chat:message': {
        if (!info) return;
        const data = (args[0] || {}) as { content: string; type: 'text' | 'emoji' };
        const message: ChatMessage = {
          id: generateMessageId(),
          userId: info.userId,
          userName: info.userName,
          content: data.content,
          type: data.type,
          timestamp: Date.now(),
        };
        // 原实现是 io.to(room)，含发送者自己
        this.toRoom(info.roomId, 'chat:message', [message]);
        break;
      }

      case 'voice:offer':
      case 'voice:answer':
      case 'voice:ice': {
        if (!info) return;
        const data = (args[0] || {}) as SignalingData;
        this.toSocket(data.targetUserId, event, [this.signalingPayload(event, socketId, data)]);
        break;
      }

      // 语音聊天的服务端中转（策略非 webrtc 时用）
      case 'voice:audio-chunk': {
        if (!info) return;
        const data = (args[0] || {}) as { audioData: number[]; sampleRate?: number };
        this.toRoom(
          info.roomId,
          'voice:audio-chunk',
          [
            {
              userId: socketId,
              audioData: data.audioData,
              sampleRate: data.sampleRate || 16000,
            },
          ],
          socketId
        );
        break;
      }

      case 'heartbeat': {
        if (info) {
          const roomMembers = this.members.get(info.roomId);
          const member = roomMembers?.get(info.userId);
          if (member) member.lastHeartbeat = Date.now();

          if (info.isOwner) {
            const room = this.rooms.get(info.roomId);
            if (room) room.lastOwnerHeartbeat = Date.now();
          }
        }
        // 无论是否在房间里都回 pong
        this.toSocket(socketId, 'heartbeat:pong', [{ timestamp: Date.now() }]);
        break;
      }

      default:
        // 未实现的事件静默忽略（含客户端会发但原服务端本就没处理的 state:clear）
        break;
    }
  }

  private signalingPayload(event: string, socketId: string, data: SignalingData): unknown {
    if (event.endsWith('offer')) return { userId: socketId, offer: data.offer };
    if (event.endsWith('answer')) return { userId: socketId, answer: data.answer };
    return { userId: socketId, candidate: data.candidate };
  }

  // ---------------------------------------------------------------- 房间生命周期

  private handleLeaveRoom(socketId: string, isExplicitLeave = false): void {
    const info = this.socketToRoom.get(socketId);
    if (!info) return;

    const { roomId, userId, isOwner } = info;
    const roomMembers = this.members.get(roomId);

    if (roomMembers) {
      roomMembers.delete(userId);
      const room = this.rooms.get(roomId);
      if (room) room.memberCount = roomMembers.size;

      this.toRoom(roomId, 'room:member-left', [userId], socketId);

      if (isOwner && isExplicitLeave) {
        // 房主主动离开：立即解散，踢出所有成员
        this.toRoom(roomId, 'room:deleted', [{ reason: 'owner_left' }], socketId);
        for (const memberId of Array.from(roomMembers.keys())) {
          this.socketToRoom.delete(memberId);
        }
        this.deleteRoom(roomId, true);
      } else if (roomMembers.size === 0) {
        // 房主断线（等重连）或普通成员走空：保留一会儿再删，替代原 setTimeout
        this.emptyRoomDeleteAt.set(roomId, Date.now() + EMPTY_ROOM_GRACE_MS);
      }
    }

    this.socketToRoom.delete(socketId);
  }

  private deleteRoom(roomId: string, skipNotify = false): void {
    if (!skipNotify) {
      this.toRoom(roomId, 'room:deleted', []);
    }

    this.rooms.delete(roomId);
    this.members.delete(roomId);
    this.emptyRoomDeleteAt.delete(roomId);

    const helper = this.screenHelpers.get(roomId);
    if (helper) {
      this.helperToRoom.delete(helper);
      this.screenHelpers.delete(roomId);
    }
  }

  // ---------------------------------------------------------------- 定时器

  private scheduleTick(): void {
    if (this.sockets.size === 0 && this.rooms.size === 0) return;
    void this.ctx.storage.setAlarm(Date.now() + TICK_MS).catch(() => {});
  }

  async alarm(): Promise<void> {
    this.tick();
    this.scheduleTick();
  }

  private tick(): void {
    const now = Date.now();

    // engine.io 心跳：v4 是服务端主动 ping，客户端回 pong
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      for (const meta of Array.from(this.sockets.values())) {
        this.send(meta.ws, '2');
      }
    }

    // 空房间延迟删除
    for (const [roomId, deleteAt] of Array.from(this.emptyRoomDeleteAt)) {
      if (now >= deleteAt) {
        this.emptyRoomDeleteAt.delete(roomId);
        const roomMembers = this.members.get(roomId);
        if (!roomMembers || roomMembers.size === 0) {
          this.deleteRoom(roomId);
        }
      }
    }

    // 房主静默：先清状态，再删房间
    for (const [roomId, room] of Array.from(this.rooms)) {
      const idle = now - room.lastOwnerHeartbeat;

      if (idle > STATE_CLEAR_MS && room.currentState !== null) {
        room.currentState = null;
        this.toRoom(roomId, 'state:cleared', []);
      }
      if (idle > ROOM_DELETE_MS) {
        this.deleteRoom(roomId);
      }
    }
  }

  // ---------------------------------------------------------------- 收发辅助

  private send(ws: CfWebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch {
      // 连接已经关了，忽略
    }
  }

  /** 发给单个连接（对应 socket.io 的 socket.emit / io.to(socketId)） */
  private toSocket(targetUserId: string, event: string, args: unknown[]): void {
    const meta = this.sockets.get(targetUserId);
    if (meta) this.send(meta.ws, encodeEvent(event, args));
  }

  /** 发给房间里所有连接（对应 io.to(room)）；传 exceptSocketId 则排除发送者（对应 socket.to(room)） */
  private toRoom(roomId: string, event: string, args: unknown[], exceptSocketId?: string): void {
    for (const [id, meta] of Array.from(this.sockets)) {
      if (id === exceptSocketId) continue;
      if (this.socketToRoom.get(id)?.roomId === roomId) {
        this.send(meta.ws, encodeEvent(event, args));
      }
    }
  }

  private applyState(roomId: string, state: Room['currentState']): void {
    const room = this.rooms.get(roomId);
    if (room) room.currentState = state;
  }

  private nextSocketId(): string {
    this.seq += 1;
    return `s_${Date.now().toString(36)}_${this.seq}_${Math.random().toString(36).slice(2, 7)}`;
  }
}
