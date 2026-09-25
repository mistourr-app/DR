import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5500;
const ROOT = path.resolve(path.dirname(__filename));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

function isPathInsideRoot(filePath) {
  const pathFromRoot = path.relative(ROOT, filePath);
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(pathFromRoot)
  );
}

export function resolveRequestPath(requestUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl || '/', `http://${HOST}:${PORT}`);
  } catch {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    return null;
  }

  if (pathname.includes('\0') || pathname.includes('\\')) {
    return null;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  const pathFromRoot = path.relative(ROOT, filePath);

  if (
    !isPathInsideRoot(filePath) ||
    pathFromRoot.split(path.sep).some((segment) => segment.startsWith('.'))
  ) {
    return null;
  }

  return filePath;
}

function sendError(res, statusCode, message, method = 'GET') {
  const body = `${message}\n`;
  const headers = {
    ...securityHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (statusCode === 405) {
    headers.Allow = 'GET, HEAD';
  }
  res.writeHead(statusCode, headers);
  res.end(method === 'HEAD' ? undefined : body);
}

export const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method Not Allowed', req.method);
    return;
  }

  const filePath = resolveRequestPath(req.url);
  if (!filePath) {
    sendError(res, 400, 'Bad Request', req.method);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.realpath(filePath, (pathError, realPath) => {
    if (pathError) {
      if (pathError.code === 'ENOENT' || pathError.code === 'EISDIR') {
        sendError(res, 404, 'Not Found', req.method);
      } else {
        sendError(res, 500, 'Server Error', req.method);
      }
      return;
    }

    if (!isPathInsideRoot(realPath)) {
      sendError(res, 400, 'Bad Request', req.method);
      return;
    }

    fs.readFile(realPath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
          sendError(res, 404, 'Not Found', req.method);
        } else {
          sendError(res, 500, 'Server Error', req.method);
        }
        return;
      }

      res.writeHead(200, {
        ...securityHeaders,
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  });
});

server.on('clientError', (error, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  }
});

export function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
