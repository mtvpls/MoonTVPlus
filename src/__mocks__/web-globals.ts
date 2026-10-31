/* eslint-disable @typescript-eslint/no-var-requires */
// Jest 27 predates the Web APIs used by Next's server runtime.
const primitives = require('next/dist/compiled/@edge-runtime/primitives');
for (const name of [
  'Request',
  'Response',
  'Headers',
  'ReadableStream',
  'TextEncoder',
  'TextDecoder',
  'DOMException',
  'AbortController',
  'AbortSignal',
]) {
  Object.defineProperty(globalThis, name, {
    value: primitives[name],
    configurable: true,
    writable: true,
  });
}
export {};
