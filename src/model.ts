export type Urgency = 0 | 1 | 2 | 3;
export type View = 'today' | 'board' | 'timeline';

export interface Task {
  id: string;
  title: string;
  project: string;
  due: string | null; // ISO "YYYY-MM-DD", date-only, local timezone
  urgency: Urgency; // manual urgency: 0=Now, 1=Soon, 2=Later, 3=Someday
  done: boolean;
  updatedAt?: number; // epoch ms of last local edit; newest wins in sync merges
}

export interface Settings {
  escalationDays: number; // 1-7, default 3
  showCompleted: boolean;
  defaultView: View;
  theme: string; // theme id from themes.ts
  lastDark: string; // remembered dark theme for the mode toggle
  lastLight: string; // remembered light theme for the mode toggle
  font: string; // font id from themes.ts
  fontScale: number; // text size multiplier
  uiScale: number; // whole-UI zoom
  keySounds: boolean;
  completionSound: boolean;
  syncEnabled: boolean;
  syncUrl: string; // sync server base URL, e.g. https://surface.up.railway.app
  syncToken: string; // shared secret for the sync server
}

export const DEFAULT_SETTINGS: Settings = {
  escalationDays: 3,
  showCompleted: true,
  defaultView: 'today',
  theme: 'dark',
  lastDark: 'dark',
  lastLight: 'light',
  font: 'instrument',
  fontScale: 1,
  uiScale: 1,
  keySounds: false,
  completionSound: true,
  syncEnabled: false,
  syncUrl: '',
  syncToken: '',
};

export const URG: { key: Urgency; label: string; color: string }[] = [
  { key: 0, label: 'Now', color: 'var(--urg-0)' },
  { key: 1, label: 'Soon', color: 'var(--urg-1)' },
  { key: 2, label: 'Later', color: 'var(--urg-2)' },
  { key: 3, label: 'Someday', color: 'var(--urg-3)' },
];

const DAY = 86400000;

/** Whole days until due (negative = overdue), null if no deadline. */
export function daysUntil(due: string | null, now: number): number | null {
  if (!due) return null;
  const [y, m, dd] = due.split('-').map(Number);
  const dueMid = new Date(y, m - 1, dd).getTime();
  const n = new Date(now);
  const todayMid = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((dueMid - todayMid) / DAY);
}

/** Deadline-derived urgency. */
export function derivedUrgency(due: string | null, now: number, soon: number): Urgency {
  const d = daysUntil(due, now);
  if (d === null) return 3;
  if (d <= 1) return 0;
  if (d <= soon) return 1;
  if (d <= Math.max(7, soon * 2)) return 2;
  return 3;
}

export interface TaskVM extends Task {
  eff: Urgency; // effective urgency = min(manual, derived)
  escalated: boolean;
  d: number | null; // days until due
  dueLabel: string;
  dueColor: string;
  urgColor: string;
}

export function toVM(t: Task, now: number, soon: number): TaskVM {
  const derived = derivedUrgency(t.due, now, soon);
  const eff = Math.min(t.urgency, derived) as Urgency;
  const escalated = !t.done && derived < t.urgency;
  const d = daysUntil(t.due, now);
  let dueLabel = '—';
  let dueColor = 'var(--text-fainter)';
  if (d !== null) {
    if (d < 0) {
      dueLabel = `${-d}d overdue`;
      dueColor = 'var(--urg-0)';
    } else if (d === 0) {
      dueLabel = 'due today';
      dueColor = 'var(--urg-0)';
    } else if (d === 1) {
      dueLabel = 'due tmrw';
      dueColor = 'var(--urg-1)';
    } else {
      dueLabel = `${d}d left`;
      dueColor = d <= soon ? 'var(--urg-1)' : 'var(--text-sec)';
    }
  }
  if (t.done) dueColor = 'var(--text-fainter)';
  return { ...t, eff, escalated, d, dueLabel, dueColor, urgColor: URG[eff].color };
}

/** done ASC, effectiveUrgency ASC, daysUntilDue ASC (null last) */
export function sortVMs(a: TaskVM, b: TaskVM): number {
  return (
    Number(a.done) - Number(b.done) ||
    a.eff - b.eff ||
    (a.d ?? 999) - (b.d ?? 999)
  );
}
