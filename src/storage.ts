import { DEFAULT_SETTINGS, type Settings, type Task } from './model';

const TASKS_KEY = 'surface.tasks.v1';
const SETTINGS_KEY = 'surface.settings.v1';
const DELETED_KEY = 'surface.deleted.v1';
const PRISTINE_KEY = 'surface.pristine.v1';
const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isoOffset(days: number): string {
  const t = new Date();
  t.setDate(t.getDate() + days);
  return (
    t.getFullYear() +
    '-' +
    String(t.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(t.getDate()).padStart(2, '0')
  );
}

function seed(): Task[] {
  const mk = (title: string, project: string, due: string | null, urgency: Task['urgency']): Task => ({
    id: crypto.randomUUID(),
    title,
    project,
    due,
    urgency,
    done: false,
  });
  return [
    mk('Get Google Ads conversion tracking working', 'Marketing', isoOffset(0), 1),
    mk('Follow up with Meridian Group on renewal', 'Sales', isoOffset(-1), 1),
    mk('Revamp YouTube videos', 'Marketing', isoOffset(2), 1),
    mk('Update landing page pricing table', 'Website', isoOffset(3), 2),
    mk('July newsletter draft', 'Content', isoOffset(4), 2),
    mk('Q3 pipeline review prep', 'Sales', isoOffset(5), 1),
    mk('Onboarding docs for new SDR', 'Team', isoOffset(6), 2),
    mk('Case study: Delta account', 'Content', isoOffset(9), 2),
    mk('Renew domain + SSL certificates', 'Ops', isoOffset(12), 3),
    mk('Clean up CRM deal stages', 'Ops', null, 3),
  ];
}

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  const tasks = seed();
  saveTasks(tasks);
  // pristine = still the untouched sample list; sync replaces it wholesale
  // instead of merging, so sample tasks don't duplicate across devices
  try {
    localStorage.setItem(PRISTINE_KEY, '1');
  } catch {
    /* storage unavailable */
  }
  return tasks;
}

export function isPristine(): boolean {
  try {
    return localStorage.getItem(PRISTINE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearPristine(): void {
  try {
    localStorage.removeItem(PRISTINE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveTasks(tasks: Task[]): void {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

export interface DeletedEntry {
  task: Task;
  deletedAt: number; // epoch ms
  purged?: boolean; // "delete forever" tombstone — hidden from UI, kept so sync doesn't resurrect it
}

export function loadDeleted(): DeletedEntry[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (raw) {
      const parsed: DeletedEntry[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - DELETED_RETENTION_MS;
        const fresh = parsed.filter((e) => e && e.task && e.deletedAt > cutoff);
        if (fresh.length !== parsed.length) saveDeleted(fresh);
        return fresh;
      }
    }
  } catch {
    /* fall through */
  }
  return [];
}

export function saveDeleted(entries: DeletedEntry[]): void {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable */
  }
}
