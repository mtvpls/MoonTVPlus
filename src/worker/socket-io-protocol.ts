// Engine.IO v4 + Socket.IO v5 的文本帧编解码。
//
// 只覆盖观影室客户端实际用到的子集：websocket 传输、默认命名空间、非二进制 payload。
//
// 线上每一帧 = engine.io 类型字符 [+ 载荷]：
//   '2' ping   '3' pong   '4' message + socket.io 包
// socket.io 包 = 类型字符 + 可选 ackId + JSON：
//   '0' CONNECT  '1' DISCONNECT  '2' EVENT  '3' ACK  '4' CONNECT_ERROR
// 所以一个带 ack 的事件帧长这样：'4' + '2' + '7' + '["room:create",{…}]' → "427[…]"

export const EIO_PING = 2;
export const EIO_PONG = 3;
export const EIO_MESSAGE = 4;

export const SIO_CONNECT = 0;
export const SIO_DISCONNECT = 1;
export const SIO_EVENT = 2;

export interface EngineFrame {
  eio: number;
  payload: string;
}

/** 拆出 engine.io 类型字符，剩下的是载荷 */
export function decodeEngineFrame(frame: string): EngineFrame {
  return { eio: frame.charCodeAt(0) - 48, payload: frame.slice(1) };
}

export interface SocketPacket {
  type: number;
  id?: number;
  data: unknown[];
}

/** 解析 socket.io 包（去掉 engine.io 的 '4' 前缀之后的那段） */
export function decodeSocketPacket(payload: string): SocketPacket | null {
  if (!payload) return null;

  const type = payload.charCodeAt(0) - 48;
  if (Number.isNaN(type)) return null;

  let rest = payload.slice(1);
  let id: number | undefined;

  // EVENT / ACK 后面紧跟数字形式的 ackId；CONNECT 后面是 '{'，DISCONNECT 后面为空
  const matched = /^\d+/.exec(rest);
  if (matched) {
    id = Number(matched[0]);
    rest = rest.slice(matched[0].length);
  }

  let data: unknown[] = [];
  if (rest) {
    try {
      const parsed: unknown = JSON.parse(rest);
      data = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }
  }

  return { type, id, data };
}

/** engine.io open 包 —— 握手，必须是连接后的第一帧 */
export function encodeOpen(sid: string, pingInterval: number, pingTimeout: number): string {
  return (
    '0' +
    JSON.stringify({
      sid,
      upgrades: [],
      pingInterval,
      pingTimeout,
      maxPayload: 100 * 1024 * 1024,
    })
  );
}

/** 回应客户端的 CONNECT（'40'） */
export function encodeConnectAck(sid: string): string {
  return '40' + JSON.stringify({ sid });
}

/** 服务端 -> 客户端的 EVENT */
export function encodeEvent(event: string, args: unknown[], id?: number): string {
  return '42' + (id === undefined ? '' : String(id)) + JSON.stringify([event, ...args]);
}

/** 服务端回客户端带回调事件的 ACK */
export function encodeAck(id: number, args: unknown[]): string {
  return '43' + String(id) + JSON.stringify(args);
}
