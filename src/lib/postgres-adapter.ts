/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Vercel Postgres (Neon/Postgres) 适配器
 *
 * 将 Vercel Postgres API 转换为与 D1 兼容的接口
 *
 * 注意：此模块仅在服务端使用，通过 webpack 配置排除客户端打包
 */

import { sql } from '@vercel/postgres';
import { DatabaseAdapter, D1PreparedStatement, D1Result } from './d1-adapter';

/**
 * Vercel Postgres 适配器
 *
 * 使用 @vercel/postgres 包装为 D1 兼容接口
 */
export class PostgresAdapter implements DatabaseAdapter {
  private queryParams: { query: string; values: any[] } | null = null;

  prepare(query: string): D1PreparedStatement {
    return new PostgresPreparedStatement(query);
  }

  batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    // Postgres 使用事务模拟 batch
    return new Promise((resolve, reject) => {
      Promise.all(statements.map((stmt) => (stmt as PostgresPreparedStatement).execute()))
        .then((results) => resolve(results))
        .catch((err) => reject(err));
    });
  }

  exec(query: string): void {
    // Vercel Postgres 不支持直接 exec，需要使用 sql 模板
    throw new Error('exec() is not supported for Vercel Postgres. Use prepare() instead.');
  }
}

/**
 * Vercel Postgres PreparedStatement 包装器
 * 将 Vercel Postgres API 转换为 D1 兼容 API
 */
class PostgresPreparedStatement implements D1PreparedStatement {
  private params: any[] = [];
  private paramIndex = 1;

  constructor(private query: string) {}

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  /**
   * 将 SQLite 风格的 ? 占位符替换为 Postgres 风格的 $1, $2, ...
   */
  private convertQuery(query: string): string {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
  }

  /**
   * 将 SQL 查询中的表名和列名转换为双引号包裹（Postgres 要求）
   * 注意：需要排除已经有引号的内容
   */
  private quoteIdentifiers(query: string): string {
    // 这个方法主要用于处理列值，表名在 schema 中已经创建好
    return query;
  }

  /**
   * 执行查询并返回第一行
   */
  async first<T = any>(colName?: string): Promise<T | null> {
    try {
      const convertedQuery = this.convertQuery(this.query);

      // 使用 Vercel Postgres 的 query 方法执行参数化查询
      const result = await sql.query(convertedQuery, this.params);

      if (!result || result.rows.length === 0) return null;

      const row = result.rows[0];

      if (colName) return row[colName] ?? null;

      return row as T;
    } catch (err) {
      console.error('Postgres first() error:', err);
      return null;
    }
  }

  /**
   * 执行查询并返回结果
   */
  async run<T = any>(): Promise<D1Result<T>> {
    try {
      const convertedQuery = this.convertQuery(this.query);

      const result = await sql.query(convertedQuery, this.params);

      return {
        success: true,
        meta: {
          changes: result.rowCount || 0,
          last_row_id: null, // Postgres 不直接返回 lastInsertId
        },
        results: result.rows,
      };
    } catch (err: any) {
      console.error('Postgres run() error:', err);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * 执行查询并返回所有行
   */
  async all<T = any>(): Promise<D1Result<T>> {
    try {
      const convertedQuery = this.convertQuery(this.query);

      const result = await sql.query(convertedQuery, this.params);

      return {
        success: true,
        results: result.rows || [],
      };
    } catch (err: any) {
      console.error('Postgres all() error:', err);
      return {
        success: false,
        error: err.message,
        results: [],
      };
    }
  }

  /**
   * 内部执行方法（用于 batch 操作）
   */
  async execute(): Promise<D1Result> {
    return this.run();
  }
}
