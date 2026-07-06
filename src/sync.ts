import { type Task } from './model';
import { type DeletedEntry } from './storage';

export interface SyncData {
  tasks: Task[];
  deleted: DeletedEntry[];
}

export interface SyncStatus {
  state: 'off' | 'syncing' | 'ok' | 'error';
  at: number | null; // last successful sync
  message?: string;
}

function normalize(data: SyncData): string {
  const tasks = [...data.tasks].sort((a, b) => a.id.localeCompare(b.id));
  const deleted = [...data.deleted].sort((a, b) => a.task.id.localeCompare(b.task.id));
  return JSON.stringify({ tasks, deleted });
}

export function sameData(a: SyncData, b: SyncData): boolean {
  return normalize(a) === normalize(b);
}

/**
 * Merge two device states. Per task id the newest `updatedAt` wins; a deletion
 * beats the task unless the task was touched after it (restored/edited elsewhere).
 * "Delete forever" tombstones (`purged`) survive so purges don't resurrect.
 */
export function mergeData(a: SyncData, b: SyncData): SyncData {
  const tasks = new Map<string, Task>();
  for (const t of [...a.tasks, ...b.tasks]) {
    const prev = tasks.get(t.id);
    if (!prev || (t.updatedAt ?? 0) > (prev.updatedAt ?? 0)) tasks.set(t.id, t);
  }

  const deleted = new Map<string, DeletedEntry>();
  for (const e of [...a.deleted, ...b.deleted]) {
    const prev = deleted.get(e.task.id);
    if (!prev) {
      deleted.set(e.task.id, e);
    } else {
      const newer = e.deletedAt > prev.deletedAt ? e : prev;
      deleted.set(e.task.id, { ...newer, purged: prev.purged || e.purged || undefined });
    }
  }

  for (const [id, e] of deleted) {
    const t = tasks.get(id);
    if (!t) continue;
    if ((t.updatedAt ?? 0) > e.deletedAt) deleted.delete(id);
    else tasks.delete(id);
  }

  return { tasks: [...tasks.values()], deleted: [...deleted.values()] };
}

export const DEFAULT_SYNC_URL = 'https://surface-production-0ad4.up.railway.app';

/** Explicit setting > the origin the web app is served from > the default server. */
export function effectiveSyncUrl(explicit: string): string {
  if (explicit) return explicit;
  if (
    typeof location !== 'undefined' &&
    location.protocol.startsWith('http') &&
    !['localhost', '127.0.0.1'].includes(location.hostname)
  ) {
    return location.origin;
  }
  return DEFAULT_SYNC_URL;
}

function apiUrl(base: string): string {
  return base.replace(/\/+$/, '') + '/api/data';
}

async function request(base: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(apiUrl(base), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) detail = 'session expired — sign in again in Settings → Account';
    throw new Error(detail);
  }
  return res;
}

export async function fetchRemote(base: string, token: string): Promise<SyncData> {
  const res = await request(base, token);
  const body = await res.json();
  return {
    tasks: Array.isArray(body.tasks) ? body.tasks : [],
    deleted: Array.isArray(body.deleted) ? body.deleted : [],
  };
}

export async function pushRemote(base: string, token: string, data: SyncData): Promise<void> {
  await request(base, token, { method: 'PUT', body: JSON.stringify(data) });
}

/**
 * Full sync round-trip: pull → merge → push (only if remote is stale).
 * `pristine` = local is still the untouched sample data; if the server already
 * has real tasks, adopt them instead of merging the samples in.
 */
export async function syncNow(
  base: string,
  token: string,
  local: SyncData,
  pristine: boolean,
): Promise<{ merged: SyncData; changedLocal: boolean }> {
  const remote = await fetchRemote(base, token);
  const effectiveLocal = pristine && remote.tasks.length > 0 ? { tasks: [], deleted: [] } : local;
  const merged = mergeData(effectiveLocal, remote);
  if (!sameData(merged, remote)) await pushRemote(base, token, merged);
  return { merged, changedLocal: !sameData(merged, local) };
}
