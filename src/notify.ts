import { type TaskVM } from './model';

const NOTIFIED_KEY = 'surface.notified.v1';

type NotifiedLog = Record<string, Record<string, string>>; // taskId -> event -> date notified

function todayStamp(): string {
  const n = new Date();
  return (
    n.getFullYear() +
    '-' +
    String(n.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(n.getDate()).padStart(2, '0')
  );
}

function loadLog(): NotifiedLog {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLog(log: NotifiedLog): void {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable */
  }
}

export function requestNotifyPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/**
 * Fire desktop notifications for tasks that are overdue, due today, or
 * newly escalated — at most once per task per event per day.
 */
export function notifyDeadlines(vms: TaskVM[]): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const log = loadLog();
  const stamp = todayStamp();
  let changed = false;

  const fire = (t: TaskVM, event: string, body: string) => {
    const entry = log[t.id] ?? {};
    if (entry[event] === stamp) return;
    entry[event] = stamp;
    log[t.id] = entry;
    changed = true;
    try {
      new Notification(t.title, { body, tag: `surface-${t.id}-${event}` });
    } catch {
      /* notification blocked */
    }
  };

  for (const t of vms) {
    if (t.done) continue;
    if (t.d !== null && t.d < 0) fire(t, 'overdue', `${-t.d}d overdue · ${t.project || 'No project'}`);
    else if (t.d === 0) fire(t, 'due-today', `Due today · ${t.project || 'No project'}`);
    else if (t.escalated) fire(t, 'escalated', `Escalated — due in ${t.d}d · ${t.project || 'No project'}`);
  }

  // prune log entries for tasks that no longer exist
  const ids = new Set(vms.map((t) => t.id));
  for (const id of Object.keys(log)) {
    if (!ids.has(id)) {
      delete log[id];
      changed = true;
    }
  }
  if (changed) saveLog(log);
}
