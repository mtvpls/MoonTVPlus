export type ConfigSubscriptionFormat = 'json' | 'base58';

export interface ParsedConfigSubscription {
  content: string;
  format: ConfigSubscriptionFormat;
}

function normalizeContent(content: string): string {
  return content.replace(/^\uFEFF/, '').trim();
}

function assertJson(content: string): void {
  const value: unknown = JSON.parse(content);
  // Configuration consumers read api_site/custom_category from an object.
  // Syntactically valid JSON such as null is not a usable configuration.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('配置文件的顶层必须是 JSON 对象');
  }
}

/**
 * Parse configuration subscription content.
 *
 * New subscriptions may return raw JSON directly. For backwards compatibility,
 * legacy subscriptions whose response body is Base58-encoded JSON are also
 * supported. The transport filename/extension and Content-Type are irrelevant;
 * detection is based solely on the response body.
 */
export async function parseConfigSubscriptionContent(
  responseBody: string
): Promise<ParsedConfigSubscription> {
  const normalized = normalizeContent(responseBody);

  if (!normalized) {
    throw new Error('配置订阅内容为空');
  }

  try {
    assertJson(normalized);
    return { content: normalized, format: 'json' };
  } catch {
    // Not raw JSON; fall through to the legacy Base58 format.
  }

  try {
    const bs58 = (await import('bs58')).default;
    const decoded = normalizeContent(
      new TextDecoder().decode(bs58.decode(normalized))
    );
    assertJson(decoded);
    return { content: decoded, format: 'base58' };
  } catch {
    throw new Error('配置格式错误：订阅内容必须是原始 JSON 对象或 Base58 编码的 JSON 对象');
  }
}
