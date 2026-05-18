const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const DEFAULT_HEADERS = {
  'accept': 'application/json;charset=UTF-8',
  'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
  'user-agent': DEFAULT_UA,
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
};

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 15000;
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const headers = { ...DEFAULT_HEADERS, ...(options.headers || {}) };
    delete headers['Content-Type']; // handled below

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers,
      timeout,
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (options.body) {
      if (typeof options.body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(options.body));
      } else {
        req.write(options.body);
      }
    }

    req.end();
  });
}

module.exports = { request, DEFAULT_UA, DEFAULT_HEADERS };
