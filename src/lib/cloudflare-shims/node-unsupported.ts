/* Cloudflare build shim for Node-only packages.
 *
 * This keeps unsupported Node dependencies out of the Worker bundle while
 * failing loudly if a Node-only code path is actually executed on Workers.
 */

function unsupported(name = 'This Node-only package'): never {
  throw new Error(`${name} is not supported in Cloudflare Workers`);
}

export function createClient(): never {
  return unsupported('redis');
}

export class Server {
  constructor() {
    unsupported('socket.io');
  }
}

export class Socket {
  constructor() {
    unsupported('socket.io');
  }
}

export class Pool {
  constructor() {
    unsupported('pg');
  }
}

export const sql = new Proxy(() => undefined, {
  apply: () => unsupported('@vercel/postgres'),
  get: () => unsupported('@vercel/postgres'),
});

const shim: any = new Proxy(
  function nodeUnsupportedDefault() {
    unsupported();
  },
  {
    apply: () => unsupported(),
    construct: () => unsupported(),
    get: (_target, prop) => {
      if (prop === 'createTransport') {
        return () => unsupported('nodemailer');
      }
      if (prop === 'default') {
        return shim;
      }
      return () => unsupported(String(prop));
    },
  }
);

export default shim;
