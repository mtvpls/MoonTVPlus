/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { StandardRedisAdapter } from './redis-adapter';
import {
  BaseRedisStorage,
  createRedisClient,
  createRetryWrapper,
} from './redis-base.db';

export class KvrocksStorage extends BaseRedisStorage {
  constructor() {
    const config = {
      url: process.env.KVROCKS_URL!,
      clientName: 'Kvrocks',
    };
    const globalSymbol = Symbol.for('__MOONTV_KVROCKS_CLIENT__');
    const client = createRedisClient(config, globalSymbol);
    const adapter = new StandardRedisAdapter(client);
    const withRetry = createRetryWrapper(config.clientName, () => client);
    super(adapter, withRetry);
  }
}
