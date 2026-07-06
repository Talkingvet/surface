# Surface — project notes for Claude Code

Calm, dark, minimal urgent-task tracker for one user (Paul, a marketer who works in
Zoho CRM). Built July 2026 from a Claude Design handoff (the design source of truth
lives on Paul's Windows PC at
`OneDrive\Documents\Claude\Design\Urgent task reminder app\design_handoff_surface`).
The README covers run/build commands; this file covers intent and conventions.

## Design fidelity rules

- The UI is a high-fidelity recreation of the handoff design. Don't restyle casually:
  Instrument Serif (italic wordmark, headlines), Instrument Sans (UI), Spline Sans Mono
  (labels/countdowns), 12px card radius, 0.15s hovers, `rise` animation on view switches.
- ALL colors must come from CSS variables (see `src/themes.ts`) — never hardcode hex in
  components, or theming breaks. Urgency colors are per-theme.
- Font sizes in components use `fs(px)` from `src/ui.ts` (px→rem) so the Text size
  setting works. Layout dimensions stay in px (UI scale handles those via body zoom).

## Core domain logic (`src/model.ts` — ported from the design prototype, treat as spec)

- Effective urgency = `min(manualUrgency, deadlineDerivedUrgency)`; lower = more urgent
  (0=Now, 1=Soon, 2=Later, 3=Someday).
- Derived urgency from days-until-due `d`: null→3, `d<=1`→0, `d<=escalationDays`→1,
  `d<=max(7, escalationDays*2)`→2, else 3. "Escalated" badge when derived < manual.
- Sort everywhere: `done ASC, effectiveUrgency ASC, daysUntilDue ASC (null last)`.

## Architecture

- React + TypeScript + Vite; Electron wrapper in `electron/main.cjs` (no IPC needed yet).
- Persistence is localStorage (offline-first cache): tasks `surface.tasks.v1`, settings
  `surface.settings.v1`, soft-deleted `surface.deleted.v1` (30-day retention).
  All storage access goes through `src/storage.ts` — keep it that way; a future phase
  adds Zoho CRM task import (OAuth).
- Accounts + cross-device sync: `server/index.mjs` (zero-dep Node, Railway project
  "surface", URL https://surface-production-0ad4.up.railway.app, volume at /data, env
  SESSION_SECRET + INVITE_CODE + DATA_DIR). Multi-user: scrypt password hashes in
  users.json, per-user data-<id>.json, HMAC-signed 180-day session tokens, invite-code
  signup, first-signup adopts legacy surface-data.json. Client: `src/auth.ts`
  (login/signup) + `src/sync.ts` (pull→merge→push; per-task `updatedAt` newest-wins;
  deletion beats task unless task touched after `deletedAt`; `purged` tombstones stop
  "delete forever" resurrection; "pristine" seed flag prevents sample-task duplication).
  Sync runs when signed in: on launch, every 30s, on focus, debounced 1.5s after changes.
  Settings → Account tab is the auth UI. Default server URL hardcoded in `src/sync.ts`
  (`DEFAULT_SYNC_URL`); web app served from the sync server uses its own origin.
  Redeploy server: `railway up --detach` from repo root.
- Sounds are WebAudio-generated in `src/sounds.ts` (no audio assets).
- Deadline notifications: `src/notify.ts`, max once per task per event per day.

## Build quirks

- Windows: `npm run dist:win` passes `-c.electronDist=node_modules/electron/dist`
  because the default extract-then-rename hits EPERM (Defender). If electron's `dist/`
  folder is missing, run `node node_modules/electron/install.js`.
- `publish: null` in the build config is required (no repo publish target).
- Mac: plain `npm run dist:mac`, must be run on macOS.
