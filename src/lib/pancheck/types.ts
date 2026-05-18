export type NetdiskCheckPlatform =
  | '115'
  | 'aliyun'
  | 'baidu'
  | 'cmcc'
  | 'pan123'
  | 'quark'
  | 'tianyi'
  | 'uc'
  | 'xunlei';

export type NetdiskCheckStatus =
  | 'pending'
  | 'checking'
  | 'valid'
  | 'invalid'
  | 'unknown'
  | 'rate_limited';

export interface NetdiskCheckResult {
  platform: NetdiskCheckPlatform;
  url: string;
  normalizedUrl: string;
  status: Exclude<NetdiskCheckStatus, 'pending' | 'checking'>;
  valid: boolean | null;
  reason?: string;
  checkedAt: number;
  durationMs: number;
  fromCache?: boolean;
  isRateLimited?: boolean;
}

export interface NetdiskCheckTaskResultItem {
  status: NetdiskCheckStatus;
  reason?: string;
  fromCache?: boolean;
  checkedAt?: number;
  durationMs?: number;
}

export interface NetdiskCheckTask {
  id: string;
  platform: NetdiskCheckPlatform;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    done: number;
    valid: number;
    invalid: number;
    unknown: number;
    rateLimited: number;
    currentBatch: number;
    totalBatches: number;
  };
  results: Record<string, NetdiskCheckTaskResultItem>;
  createdAt: number;
  updatedAt: number;
  error?: string;
  shouldStop?: boolean;
}

export interface NetdiskCheckStartInput {
  platform: NetdiskCheckPlatform;
  links: string[];
}
