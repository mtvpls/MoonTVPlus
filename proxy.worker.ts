/* eslint-disable */

type WorkerFetchEvent = Event & {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
};

const onFetch: EventListener = (event) => {
  const fetchEvent = event as WorkerFetchEvent;
  fetchEvent.respondWith(handleRequest(fetchEvent.request));
};

addEventListener('fetch', onFetch);

async function handleRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    let actualUrl = decodeURIComponent(url.pathname.replace('/', ''));
    actualUrl = ensureProtocol(actualUrl, url.protocol);
    actualUrl += url.search;

    const newHeaders = filterHeaders(request.headers, (name) => !name.startsWith('cf-'));
    const modifiedRequest = new Request(actualUrl, {
      headers: newHeaders,
      method: request.method,
      body: request.body,
      redirect: 'manual',
    });

    const response = await fetch(modifiedRequest);
    let body: BodyInit | ReadableStream<Uint8Array> | null = response.body;

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return handleRedirect(response, body);
    }

    if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(response, url.protocol, url.host, actualUrl);
    }

    const modifiedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    setNoCacheHeaders(modifiedResponse.headers);
    setCorsHeaders(modifiedResponse.headers);

    return modifiedResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
}

function ensureProtocol(url: string, defaultProtocol: string): string {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `${defaultProtocol}//${url}`;
}

function handleRedirect(
  response: Response,
  body: BodyInit | ReadableStream<Uint8Array> | null
): Response {
  const locationHeader = response.headers.get('location');
  if (!locationHeader) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const location = new URL(locationHeader);
  const modifiedLocation = `/${encodeURIComponent(location.toString())}`;
  const headers = new Headers(response.headers);
  headers.set('Location', modifiedLocation);

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleHtmlContent(
  response: Response,
  protocol: string,
  host: string,
  actualUrl: string
): Promise<string> {
  const originalText = await response.text();
  return replaceRelativePaths(originalText, protocol, host, new URL(actualUrl).origin);
}

function replaceRelativePaths(text: string, protocol: string, host: string, origin: string): string {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

function jsonResponse(data: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function filterHeaders(headers: Headers, filterFunc: (name: string) => boolean): Headers {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

function setNoCacheHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-store');
}

function setCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', '*');
}

function getRootHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>Proxy Everything</title>
  <link rel="icon" type="image/png" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="Description" content="Proxy Everything with CF Workers.">
  <meta property="og:description" content="Proxy Everything with CF Workers.">
  <meta property="og:image" content="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Content-Language" content="zh-CN">
  <meta name="copyright" content="Copyright © ymyuuu">
  <meta name="author" content="ymyuuu">
  <link rel="apple-touch-icon-precomposed" sizes="120x120" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <style>
      body, html {
          height: 100%;
          margin: 0;
      }
      .background {
          background-image: url('https://imgapi.cn/bing.php');
          background-size: cover;
          background-position: center;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
      }
      .card {
          background-color: rgba(255, 255, 255, 0.8);
          transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card:hover {
          background-color: rgba(255, 255, 255, 1);
          box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
      }
      .input-field input[type=text] {
          color: #2c3e50;
      }
      .input-field input[type=text]:focus+label {
          color: #2c3e50 !important;
      }
      .input-field input[type=text]:focus {
          border-bottom: 1px solid #2c3e50 !important;
          box-shadow: 0 1px 0 0 #2c3e50 !important;
      }
  </style>
</head>
<body>
  <div class="background">
      <div class="container">
          <div class="row">
              <div class="col s12 m8 offset-m2 l6 offset-l3">
                  <div class="card">
                      <div class="card-content">
                          <span class="card-title center-align"><i class="material-icons left">link</i>Proxy Everything</span>
                          <form id="urlForm" onsubmit="redirectToProxy(event)">
                              <div class="input-field">
                                  <input type="text" id="targetUrl" placeholder="在此输入目标地址" required>
                                  <label for="targetUrl">目标地址</label>
                              </div>
                              <button type="submit" class="btn waves-effect waves-light teal darken-2 full-width">跳转</button>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
      function redirectToProxy(event) {
          event.preventDefault();
          const targetUrl = document.getElementById('targetUrl').value.trim();
          const currentOrigin = window.location.origin;
          window.open(currentOrigin + '/' + encodeURIComponent(targetUrl), '_blank');
      }
  </script>
</body>
</html>`;
}