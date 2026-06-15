/* Cloudflare build shim: Workers provide standards-based fetch globally. */

export default function nodeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, init);
}

export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
