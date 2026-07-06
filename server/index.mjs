// Surface sync server — zero-dependency Node HTTP server with multi-user accounts.
// Serves the built web app from ../dist and a session-protected per-user sync API.
//
// Env:
//   PORT            — listen port (Railway sets this)
//   SESSION_SECRET  — HMAC key for session tokens (required)
//   INVITE_CODE     — required to create an account
//   DATA_DIR        — where user + task data lives (mount a volume here)
//
// Storage layout in DATA_DIR:
//   users.json            — { [email]: { id, email, salt, hash, createdAt } }
//   data-<userId>.json    — { tasks, deleted, rev, updatedAt } per user
//   surface-data.json     — legacy single-user data; adopted by the first signup

import { createServer } from 'node:http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.SESSION_SECRET || '';
const INVITE = process.env.INVITE_CODE || '';
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const LEGACY_FILE = join(DATA_DIR, 'surface-data.json');
const DIST = resolve(__dirname, '..', 'dist');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB
const SESSION_DAYS = 180;

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

// ---------- storage ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

function loadUsers() {
  return readJson(USERS_FILE, {});
}

function userDataFile(userId) {
  return join(DATA_DIR, `data-${userId}.json`);
}

function loadUserData(userId) {
  const d = readJson(userDataFile(userId), null);
  if (d && Array.isArray(d.tasks) && Array.isArray(d.deleted)) return d;
  return { tasks: [], deleted: [], rev: 0, updatedAt: 0 };
}

// ---------- auth ----------

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signSession(userId) {
  const payload = b64url(JSON.stringify({ u: userId, exp: Date.now() + SESSION_DAYS * 86400000 }));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `v1.${payload}.${sig}`;
}

function verifySession(token) {
  try {
    const [v, payload, sig] = String(token).split('.');
    if (v !== 'v1' || !payload || !sig) return null;
    const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!u || Date.now() > exp) return null;
    return u;
  } catch {
    return null;
  }
}

function sessionUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const userId = verifySession(header.slice(7));
  if (!userId) return null;
  const users = loadUsers();
  return Object.values(users).find((u) => u.id === userId) || null;
}

// naive per-IP throttle for auth endpoints: 20 attempts/hour
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 3600000) {
    entry.count = 0;
    entry.since = now;
  }
  entry.count++;
  attempts.set(ip, entry);
  return entry.count > 20;
}

// ---------- http helpers ----------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function sendJson(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
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

// ---------- handlers ----------

function handleSignup(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const invite = String(body.invite || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return [400, { error: 'enter a valid email' }];
  if (password.length < 8) return [400, { error: 'password must be at least 8 characters' }];
  if (!INVITE || invite !== INVITE) return [403, { error: 'invalid invite code' }];

  const users = loadUsers();
  if (users[email]) return [409, { error: 'an account with this email already exists' }];

  const salt = randomBytes(16).toString('hex');
  const user = {
    id: randomUUID(),
    email,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
  };

  // the very first account adopts the legacy single-user data, if any
  const isFirstUser = Object.keys(users).length === 0;
  if (isFirstUser && existsSync(LEGACY_FILE)) {
    renameSync(LEGACY_FILE, userDataFile(user.id));
  }

  users[email] = user;
  writeJson(USERS_FILE, users);
  return [200, { token: signSession(user.id), email }];
}

function handleLogin(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = loadUsers()[email];
  if (user) {
    const candidate = Buffer.from(hashPassword(password, user.salt), 'hex');
    const stored = Buffer.from(user.hash, 'hex');
    if (candidate.length === stored.length && timingSafeEqual(candidate, stored)) {
      return [200, { token: signSession(user.id), email }];
    }
  }
  return [401, { error: 'wrong email or password' }];
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
    sendJson(res, 200, { ok: true, configured: Boolean(SECRET && INVITE) });
    return;
  }

  if (path.startsWith('/api/') && (!SECRET || !INVITE)) {
    sendJson(res, 500, { error: 'server missing SESSION_SECRET or INVITE_CODE' });
    return;
  }

  if ((path === '/api/signup' || path === '/api/login') && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
    if (throttled(ip)) {
      sendJson(res, 429, { error: 'too many attempts — try again later' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const [status, payload] = path === '/api/signup' ? handleSignup(body) : handleLogin(body);
      sendJson(res, status, payload);
    } catch (e) {
      sendJson(res, 400, { error: String(e.message || e) });
    }
    return;
  }

  if (path === '/api/me') {
    const user = sessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    sendJson(res, 200, { email: user.email });
    return;
  }

  if (path === '/api/data') {
    const user = sessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, loadUserData(user.id));
      return;
    }
    if (req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!Array.isArray(body.tasks) || !Array.isArray(body.deleted)) {
          sendJson(res, 400, { error: 'expected { tasks: [], deleted: [] }' });
          return;
        }
        const prev = loadUserData(user.id);
        const next = {
          tasks: body.tasks,
          deleted: body.deleted,
          rev: (prev.rev || 0) + 1,
          updatedAt: Date.now(),
        };
        writeJson(userDataFile(user.id), next);
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
  const users = Object.keys(loadUsers()).length;
  const dataFiles = readdirSync(DATA_DIR).filter((f) => f.startsWith('data-')).length;
  console.log(
    `Surface server on :${PORT} (users: ${users}, data files: ${dataFiles}, configured: ${Boolean(SECRET && INVITE)})`,
  );
});
