// Cloudflare Workers 运行时里存在、但 DOM lib 里没有的类型。
//
// 项目没有装 @cloudflare/workers-types（它和 lib 里的 "dom" 会在 WebSocket/Response
// 等名字上冲突）。所以这里只声明观影室 DO 用到的部分，并且用 export 而非全局
// declare，避免污染整个项目的全局类型空间。

/** Workers 侧 WebSocket —— 服务端那一半，比 DOM 的多了 accept() */
export interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void
  ): void;
  addEventListener(type: 'close' | 'error', listener: (event: unknown) => void): void;
  /** 把少量元数据挂在连接上，跨休眠/重启保留（本 DO 用非休眠模式，暂未用到） */
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface DurableObjectStorage {
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface WebSocketPairCtor {
  new (): { 0: CfWebSocket; 1: CfWebSocket };
}

/** Workers 运行时全局，本地 dev（node）下不存在，所以只声明不 deref */
export const WebSocketPair = (
  globalThis as unknown as { WebSocketPair: WebSocketPairCtor }
).WebSocketPair;
