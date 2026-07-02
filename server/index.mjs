// Surface sync server — zero-dependency Node HTTP server.
// Serves the built web app from ../dist and a token-protected sync API.
//
// Env:
//   PORT        — listen port (Railway sets this)
//   SYNC_TOKEN  — shared secret; required for /api/data
//   DATA_DIR    — where surface-data.json lives (mount a volume here)

import { createServer } from 'node:http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.SYNC_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'surface-data.json');
const DIST = resolve(__dirname, '..', 'dist');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB

mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function loadData() {
  try {
    const d = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    if (d && Array.isArray(d.tasks) && Array.isArray(d.deleted)) return d;
  } catch {
    /* first run or corrupt file */
  }
  return { tasks: [], deleted: [], rev: 0, updatedAt: 0 };
}

function saveData(data) {
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, DATA_FILE);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function sendJson(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  if (!TOKEN) return false;
  const header = req.headers.authorization || '';
  return header === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = normalize(join(DIST, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html'); // SPA fallback
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found — was the web app built? (npm run build)');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === '/api/health') {
    sendJson(res, 200, { ok: true, hasToken: Boolean(TOKEN) });
    return;
  }

  if (path === '/api/data') {
    if (!TOKEN) {
      sendJson(res, 500, { error: 'SYNC_TOKEN not configured on server' });
      return;
    }
    if (!authorized(req)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, loadData());
      return;
    }
    if (req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!Array.isArray(body.tasks) || !Array.isArray(body.deleted)) {
          sendJson(res, 400, { error: 'expected { tasks: [], deleted: [] }' });
          return;
        }
        const prev = loadData();
        const next = {
          tasks: body.tasks,
          deleted: body.deleted,
          rev: (prev.rev || 0) + 1,
          updatedAt: Date.now(),
        };
        saveData(next);
        sendJson(res, 200, { rev: next.rev, updatedAt: next.updatedAt });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e) });
      }
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, path);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Surface server on :${PORT} (data: ${DATA_FILE}, token: ${TOKEN ? 'set' : 'MISSING'})`);
});
