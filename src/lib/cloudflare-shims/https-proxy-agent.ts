/* Cloudflare build shim: outbound proxy agents are not supported by Workers. */

export class HttpsProxyAgent {
  constructor(..._args: unknown[]) {
    throw new Error('HttpsProxyAgent is not supported in Cloudflare Workers');
  }
}
