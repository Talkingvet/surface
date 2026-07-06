# Surface

A calm, dark, minimal urgent-task tracker. Built from the Claude Design handoff at
`OneDrive\Documents\Claude\Design\Urgent task reminder app\design_handoff_surface`.

Three views — **Today** (what needs you now), **Board** (four urgency columns),
**Timeline** (grouped by deadline). Tasks auto-escalate as deadlines approach and
show live countdown chips. Desktop notifications fire (once per day per task) when a
task goes overdue, is due today, or newly escalates — allow notifications when prompted.

## Desktop app

### Windows

Installed at `%LOCALAPPDATA%\Programs\surface\Surface.exe` with Desktop and
Start Menu shortcuts ("Surface"). To rebuild the installer after code changes:

```
npm run dist:win    # output: release\Surface Setup 1.0.0.exe
```

### Mac

Desktop apps must be built on the platform they target, so run this on the Mac:

```
npm install
npm run dist:mac    # output: release\Surface-1.0.0-*.dmg
```

Open the `.dmg` from `release/` and drag Surface into Applications.

On either platform, `npm run desktop` runs the desktop app straight from
source without installing.

Note: tasks and settings are stored per-machine (localStorage), so the
Windows and Mac apps keep separate task lists.

## Web app

```
npm run dev         # dev server at http://localhost:5173
npm run build       # static site in dist\ — host anywhere (Netlify, Vercel, etc.)
npm run preview     # serve the production build locally
```

## Accounts & sync across devices

`server/index.mjs` is a zero-dependency Node server with multi-user accounts. It
stores each user's tasks as JSON on a volume and serves the built web app. Deployed
on Railway; env vars: `SESSION_SECRET` (HMAC key for session tokens), `INVITE_CODE`
(required to create an account), `DATA_DIR=/data` with a volume mounted at `/data`.

On each device: Settings → Account → sign in (or create an account with the invite
code). Tasks and Recently Deleted sync per-account (newest edit wins); appearance
settings stay per-device. The app stays offline-first — localStorage is the cache
and syncs on launch, every 30s, on window focus, and ~1.5s after any change.
Passwords are scrypt-hashed; sessions are signed HMAC tokens valid 180 days.
The first account ever created adopts any legacy single-user data on the server.

Run the server locally for testing:

```
$env:SESSION_SECRET='some-secret'; $env:INVITE_CODE='letmein'; $env:PORT='8787'; node server/index.mjs
```

## Data & settings

Tasks persist locally (browser/app `localStorage`, key `surface.tasks.v1`).
The desktop app and each browser keep their own separate task lists.

Settings live in `localStorage` under `surface.settings.v1`:

```json
{ "escalationDays": 3, "showCompleted": true, "defaultView": "today" }
```

- `escalationDays` (1–7) — the "soon" window used for escalation and amber countdowns.
- `showCompleted` — `false` hides done tasks everywhere.
- `defaultView` — `"today" | "board" | "timeline"`.

## Code map

- `src/model.ts` — Task type, urgency escalation + countdown algorithms (ported from the design prototype)
- `src/storage.ts` — localStorage persistence + first-run seed tasks
- `src/notify.ts` — deadline desktop notifications
- `src/App.tsx` — all views + task editor modal
- `electron/main.cjs` — desktop wrapper (Electron)

A future phase per the design intent: sync tasks from Zoho CRM via its API instead
of manual entry — the storage layer is isolated in `src/storage.ts` to make that swap easy.
