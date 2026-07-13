import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  URG,
  sortVMs,
  toVM,
  type Settings,
  type Task,
  type TaskVM,
  type Urgency,
  type View,
} from './model';
import {
  clearPristine,
  isPristine,
  loadDeleted,
  loadSettings,
  loadSubjects,
  loadTasks,
  saveDeleted,
  saveSettings,
  saveSubjects,
  saveTasks,
  type DeletedEntry,
} from './storage';
import { effectiveSyncUrl, syncNow, type SyncStatus } from './sync';
import { login, signup } from './auth';
import { notifyDeadlines, requestNotifyPermission } from './notify';
import { applyAppearance } from './themes';
import { playComplete, playKeyClick } from './sounds';
import { fs } from './ui';
import SettingsModal from './Settings';

interface Draft {
  title: string;
  project: string;
  due: string;
  urgency: Urgency;
}

const EMPTY_DRAFT: Draft = { title: '', project: '', due: '', urgency: 1 };

function Check({ vm, small, onToggle }: { vm: TaskVM; small?: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      className={`check${small ? ' small' : ''}${vm.done ? ' done' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(vm.id);
      }}
      aria-label={vm.done ? 'Mark as not done' : 'Mark as done'}
    >
      {vm.done ? '✓' : ''}
    </button>
  );
}

function TaskRow({
  vm,
  compact,
  showDot,
  onToggle,
  onOpen,
}: {
  vm: TaskVM;
  compact?: boolean;
  showDot?: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className={`task-row${compact ? ' compact' : ''}`}
      style={{ opacity: vm.done ? 0.45 : 1 }}
      onClick={() => onOpen(vm.id)}
    >
      <Check vm={vm} small={compact} onToggle={onToggle} />
      {showDot && <div className="dot" style={{ background: vm.urgColor }} />}
      {compact ? (
        <>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: fs(14.5),
              fontWeight: 500,
              textDecoration: vm.done ? 'line-through' : 'none',
            }}
          >
            {vm.title}
          </div>
          <div style={{ fontSize: fs(12.5), color: 'var(--text-ter)' }}>{vm.project}</div>
          <div
            className="mono"
            style={{ fontSize: fs(12), color: vm.dueColor, minWidth: 88, textAlign: 'right' }}
          >
            {vm.dueLabel}
          </div>
        </>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: fs(15),
                fontWeight: 500,
                textDecoration: vm.done ? 'line-through' : 'none',
              }}
            >
              {vm.title}
            </div>
            <div style={{ marginTop: 3, fontSize: fs(12.5), color: 'var(--text-ter)' }}>
              {vm.project}
            </div>
          </div>
          {vm.escalated && <div className="escalated-badge">↑ escalated</div>}
          <div
            className="mono"
            style={{ fontSize: fs(12.5), color: vm.dueColor, minWidth: 92, textAlign: 'right' }}
          >
            {vm.dueLabel}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div className="dot" style={{ background: color }} />
      <div className="section-label">{label}</div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [deleted, setDeleted] = useState<DeletedEntry[]>(loadDeleted);
  const [view, setView] = useState<View>(settings.defaultView);
  const [subject, setSubject] = useState<string | null>(null); // lowercased project key; null = all, '' = no subject
  const [remembered, setRemembered] = useState<string[]>(loadSubjects); // subjects ever used, newest first
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [now, setNow] = useState(() => Date.now());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'off', at: null });
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const stateRef = useRef({ tasks, deleted, settings });
  stateRef.current = { tasks, deleted, settings };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    requestNotifyPermission();
    return () => clearInterval(timer);
  }, []);

  // theme / font / scale
  useEffect(() => {
    applyAppearance({
      themeId: settings.theme,
      fontId: settings.font,
      fontScale: settings.fontScale,
      uiScale: settings.uiScale,
    });
  }, [settings.theme, settings.font, settings.fontScale, settings.uiScale]);

  // keyboard sounds
  useEffect(() => {
    if (!settings.keySounds) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') {
        playKeyClick();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings.keySounds]);

  // Escape closes modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditorOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const updateSettings = (next: Settings) => {
    saveSettings(next);
    setSettings(next);
  };

  const applyAuth = (token: string, email: string) => {
    const next = { ...stateRef.current.settings, authToken: token, authEmail: email };
    updateSettings(next);
    stateRef.current.settings = next; // runSync reads the ref; don't wait for re-render
  };

  const signIn = async (email: string, password: string) => {
    const r = await login(effectiveSyncUrl(stateRef.current.settings.syncUrl), email, password);
    applyAuth(r.token, r.email);
    void runSync();
  };

  const signUp = async (email: string, password: string, invite: string) => {
    const r = await signup(
      effectiveSyncUrl(stateRef.current.settings.syncUrl),
      email,
      password,
      invite,
    );
    applyAuth(r.token, r.email);
    void runSync();
  };

  const signOut = () => {
    applyAuth('', '');
    setSyncStatus({ state: 'off', at: null });
  };

  const updateTasks = (next: Task[]) => {
    saveTasks(next);
    setTasks(next);
  };

  const updateDeleted = (next: DeletedEntry[]) => {
    saveDeleted(next);
    setDeleted(next);
  };

  const runSync = useCallback(async () => {
    const { tasks, deleted, settings } = stateRef.current;
    if (!settings.authToken) {
      setSyncStatus({ state: 'off', at: null });
      return;
    }
    if (syncBusy.current) {
      syncAgain.current = true;
      return;
    }
    syncBusy.current = true;
    setSyncStatus((s) => ({ ...s, state: 'syncing' }));
    try {
      const { merged, changedLocal } = await syncNow(
        effectiveSyncUrl(settings.syncUrl),
        settings.authToken,
        { tasks, deleted },
        isPristine(),
      );
      clearPristine();
      if (changedLocal) {
        saveTasks(merged.tasks);
        saveDeleted(merged.deleted);
        setTasks(merged.tasks);
        setDeleted(merged.deleted);
      }
      setSyncStatus({ state: 'ok', at: Date.now() });
    } catch (e) {
      setSyncStatus({ state: 'error', at: null, message: e instanceof Error ? e.message : String(e) });
    } finally {
      syncBusy.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        void runSync();
      }
    }
  }, []);

  // sync on start / when the session changes, then every 30s and on window focus
  useEffect(() => {
    void runSync();
    const interval = setInterval(() => void runSync(), 30000);
    const onFocus = () => void runSync();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [runSync, settings.authToken, settings.syncUrl]);

  // push local changes shortly after they happen
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void runSync(), 1500);
    return () => clearTimeout(t);
  }, [tasks, deleted, runSync]);

  const soon = settings.escalationDays;
  const vms = useMemo(() => tasks.map((t) => toVM(t, now, soon)), [tasks, now, soon]);

  useEffect(() => {
    notifyDeadlines(vms);
  }, [vms]);

  // subjects = distinct task projects, grouped case-insensitively ('' = tasks with none)
  const subjects = useMemo(() => {
    const map = new Map<string, { label: string; active: number }>();
    for (const t of tasks) {
      const label = t.project.trim();
      const key = label.toLowerCase();
      let entry = map.get(key);
      if (!entry) {
        entry = { label, active: 0 };
        map.set(key, entry);
      }
      if (!t.done) entry.active++;
    }
    return map;
  }, [tasks]);

  const namedSubjects = [...subjects.entries()]
    .filter(([key]) => key !== '')
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const unfiled = subjects.get('');

  // if the filtered subject's last task is deleted or renamed, fall back to All
  useEffect(() => {
    if (subject !== null && !subjects.has(subject)) setSubject(null);
  }, [subject, subjects]);

  // editor auto-fill: remembered subjects (newest first), then any on current tasks
  // (covers subjects that arrived via sync from another device)
  const suggestions = (() => {
    const seen = new Set(remembered.map((s) => s.toLowerCase()));
    const merged = [...remembered];
    for (const s of namedSubjects) if (!seen.has(s.key)) merged.push(s.label);
    return merged;
  })();

  const rememberSubject = (label: string) => {
    if (!label) return;
    const next = [
      label,
      ...remembered.filter((s) => s.toLowerCase() !== label.toLowerCase()),
    ].slice(0, 20);
    setRemembered(next);
    saveSubjects(next);
  };

  const forgetSubject = (label: string) => {
    const next = remembered.filter((s) => s.toLowerCase() !== label.toLowerCase());
    setRemembered(next);
    saveSubjects(next);
  };

  // chips offered under the Subject field: typing narrows, exact match hides
  const draftSubject = draft.project.trim().toLowerCase();
  const subjectPicks = editorOpen
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase() !== draftSubject &&
            (draftSubject === '' || s.toLowerCase().includes(draftSubject)),
        )
        .slice(0, 6)
    : [];

  const bySubject =
    subject === null ? vms : vms.filter((t) => t.project.trim().toLowerCase() === subject);
  const visible = settings.showCompleted ? bySubject : bySubject.filter((t) => !t.done);
  const active = visible.filter((t) => !t.done);

  const nowTasks = visible.filter((t) => t.eff === 0).sort(sortVMs);
  const nextTasks = visible.filter((t) => t.eff === 1 && !t.done).sort(sortVMs);
  const restCount = active.filter((t) => t.eff >= 2).length;
  const nowCount = nowTasks.filter((t) => !t.done).length;

  const dateFmt = new Date(now).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const headline =
    nowCount === 0
      ? 'All clear for today.'
      : nowCount === 1
        ? 'One thing needs you now.'
        : `${nowCount} things need you now.`;
  const overdueCount = active.filter((t) => t.d !== null && t.d < 0).length;
  const subline =
    overdueCount > 0
      ? `${overdueCount} overdue · ${active.length} active tasks in total`
      : `${active.length} active tasks · nothing overdue`;

  const boardCols = URG.map((u) => {
    const list = visible.filter((t) => t.eff === u.key).sort(sortVMs);
    return { ...u, count: list.filter((t) => !t.done).length, tasks: list };
  });

  const timelineGroups = [
    {
      label: 'Overdue',
      color: 'var(--urg-0)',
      sub: 'needs immediate attention',
      test: (t: TaskVM) => t.d !== null && t.d < 0,
    },
    { label: 'Today', color: 'var(--urg-0)', sub: dateFmt, test: (t: TaskVM) => t.d === 0 },
    { label: 'Tomorrow', color: 'var(--urg-1)', sub: '', test: (t: TaskVM) => t.d === 1 },
    {
      label: 'This week',
      color: 'var(--urg-1)',
      sub: `next ${Math.max(soon, 2)}–7 days`,
      test: (t: TaskVM) => t.d !== null && t.d > 1 && t.d <= 7,
    },
    {
      label: 'Further out',
      color: 'var(--text-sec)',
      sub: 'beyond a week',
      test: (t: TaskVM) => t.d !== null && t.d > 7,
    },
    {
      label: 'No deadline',
      color: 'var(--text-sec)',
      sub: 'sorted by urgency',
      test: (t: TaskVM) => t.d === null,
    },
  ]
    .map((b) => ({ ...b, tasks: visible.filter(b.test).sort(sortVMs) }))
    .filter((g) => g.tasks.length > 0);

  const toggle = (id: string) => {
    const target = tasks.find((t) => t.id === id);
    if (target && !target.done && settings.completionSound) playComplete();
    clearPristine();
    updateTasks(
      tasks.map((t) => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t)),
    );
  };

  const openTask = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setEditingId(id);
    setDraft({ title: t.title, project: t.project, due: t.due || '', urgency: t.urgency });
    setEditorOpen(true);
  };

  const openComposer = () => {
    setEditingId(null);
    // when filtered to a subject, start new tasks in that subject
    const filtered = subject ? subjects.get(subject)?.label : '';
    setDraft({ ...EMPTY_DRAFT, project: filtered || '' });
    setEditorOpen(true);
  };

  const saveDraft = () => {
    if (!draft.title.trim()) return;
    clearPristine();
    const fields = {
      title: draft.title.trim(),
      project: draft.project.trim(),
      due: draft.due || null,
      urgency: draft.urgency,
      updatedAt: Date.now(),
    };
    if (editingId) {
      updateTasks(tasks.map((t) => (t.id === editingId ? { ...t, ...fields } : t)));
    } else {
      updateTasks([...tasks, { id: crypto.randomUUID(), ...fields, done: false }]);
    }
    rememberSubject(fields.project);
    setEditorOpen(false);
  };

  // soft delete: move to Recently Deleted (kept 30 days)
  const deleteTask = () => {
    const target = tasks.find((t) => t.id === editingId);
    clearPristine();
    if (target) updateDeleted([{ task: target, deletedAt: Date.now() }, ...deleted]);
    updateTasks(tasks.filter((t) => t.id !== editingId));
    setEditorOpen(false);
  };

  const restoreTask = (id: string) => {
    const entry = deleted.find((e) => e.task.id === id);
    if (!entry) return;
    clearPristine();
    updateTasks([...tasks, { ...entry.task, updatedAt: Date.now() }]);
    updateDeleted(deleted.filter((e) => e.task.id !== id));
  };

  // "delete forever": keep a hidden tombstone so sync doesn't resurrect it
  const purgeTask = (id: string) => {
    clearPristine();
    updateDeleted(deleted.map((e) => (e.task.id === id ? { ...e, purged: true } : e)));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-pri)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 32px 80px 32px' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '26px 0 22px 0',
            borderBottom: '1px solid var(--border-hair)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <div
              style={{
                fontFamily: "'Instrument Serif', serif",
                fontStyle: 'italic',
                fontSize: fs(24),
                letterSpacing: '0.01em',
              }}
            >
              Surface
            </div>
            <div style={{ fontSize: fs(13), color: 'var(--text-ter)' }}>{dateFmt}</div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 10,
              padding: 3,
            }}
          >
            {(
              [
                { key: 'today', label: 'Today' },
                { key: 'board', label: 'Board' },
                { key: 'timeline', label: 'Timeline' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                className={`tab${view === t.key ? ' active' : ''}`}
                onClick={() => setView(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
              <GearIcon />
            </button>
            <button className="btn-primary" onClick={openComposer}>
              + New task
            </button>
          </div>
        </div>

        {/* Subject filter */}
        {namedSubjects.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 18 }}>
            <button
              className={`subject-chip${subject === null ? ' active' : ''}`}
              onClick={() => setSubject(null)}
            >
              All
              <span className="chip-count mono">{vms.filter((t) => !t.done).length}</span>
            </button>
            {namedSubjects.map((s) => (
              <button
                key={s.key}
                className={`subject-chip${subject === s.key ? ' active' : ''}`}
                onClick={() => setSubject(subject === s.key ? null : s.key)}
              >
                {s.label}
                <span className="chip-count mono">{s.active}</span>
              </button>
            ))}
            {unfiled && (
              <button
                className={`subject-chip${subject === '' ? ' active' : ''}`}
                onClick={() => setSubject(subject === '' ? null : '')}
              >
                No subject
                <span className="chip-count mono">{unfiled.active}</span>
              </button>
            )}
          </div>
        )}

        {/* Today */}
        {view === 'today' && (
          <div className="view" key="today">
            <div style={{ padding: '44px 0 36px 0' }}>
              <div
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontSize: fs(42),
                  lineHeight: 1.15,
                  letterSpacing: '-0.01em',
                }}
              >
                {headline}
              </div>
              <div style={{ marginTop: 10, fontSize: fs(14.5), color: 'var(--text-sec)' }}>
                {subline}
              </div>
            </div>

            <div style={{ marginBottom: 36 }}>
              <SectionHeader color="var(--urg-0)" label="Needs you now" />
              {nowTasks.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {nowTasks.map((t) => (
                    <TaskRow key={t.id} vm={t} onToggle={toggle} onOpen={openTask} />
                  ))}
                </div>
              ) : (
                <div className="empty-box">Nothing urgent right now — nice.</div>
              )}
            </div>

            {nextTasks.length > 0 && (
              <div style={{ marginBottom: 36 }}>
                <SectionHeader color="var(--urg-1)" label="Coming up" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {nextTasks.map((t) => (
                    <TaskRow key={t.id} vm={t} onToggle={toggle} onOpen={openTask} />
                  ))}
                </div>
              </div>
            )}

            {restCount > 0 && (
              <div style={{ fontSize: fs(13.5), color: 'var(--text-faint)', paddingTop: 4 }}>
                {restCount} more task{restCount === 1 ? '' : 's'} further out.{' '}
                <a
                  href="#"
                  className="board-link"
                  onClick={(e) => {
                    e.preventDefault();
                    setView('board');
                  }}
                >
                  View the board →
                </a>
              </div>
            )}
          </div>
        )}

        {/* Board */}
        {view === 'board' && (
          <div className="view" key="board" style={{ paddingTop: 36 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 18,
                alignItems: 'start',
              }}
            >
              {boardCols.map((col) => (
                <div key={col.key}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      paddingBottom: 12,
                      borderBottom: '1px solid var(--border-hair)',
                      marginBottom: 12,
                    }}
                  >
                    <div className="dot" style={{ background: col.color }} />
                    <div className="section-label" style={{ color: 'var(--text-strong)' }}>
                      {col.label}
                    </div>
                    <div
                      className="mono"
                      style={{ marginLeft: 'auto', fontSize: fs(11.5), color: 'var(--text-faint)' }}
                    >
                      {col.count}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {col.tasks.map((t) => (
                      <div
                        key={t.id}
                        className="board-card"
                        style={{ opacity: t.done ? 0.45 : 1 }}
                        onClick={() => openTask(t.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ marginTop: 1, display: 'flex' }}>
                            <Check vm={t} small onToggle={toggle} />
                          </div>
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: fs(14),
                              fontWeight: 500,
                              lineHeight: 1.35,
                              textDecoration: t.done ? 'line-through' : 'none',
                            }}
                          >
                            {t.title}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginTop: 10,
                            paddingLeft: 28,
                          }}
                        >
                          <div
                            style={{
                              fontSize: fs(12),
                              color: 'var(--text-ter)',
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.project}
                          </div>
                          {t.escalated && (
                            <div className="mono" style={{ fontSize: fs(10.5), color: 'var(--esc-fg)' }}>
                              ↑
                            </div>
                          )}
                          <div className="mono" style={{ fontSize: fs(11.5), color: t.dueColor }}>
                            {t.dueLabel}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {view === 'timeline' && (
          <div className="view" key="timeline" style={{ paddingTop: 36, maxWidth: 760 }}>
            {timelineGroups.map((g) => (
              <div key={g.label} style={{ marginBottom: 30 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: '1px solid var(--border-hair)',
                    marginBottom: 10,
                  }}
                >
                  <div className="section-label" style={{ color: g.color }}>
                    {g.label}
                  </div>
                  <div style={{ fontSize: fs(12), color: 'var(--text-faint)' }}>{g.sub}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} vm={t} compact showDot onToggle={toggle} onOpen={openTask} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Editor */}
        {editorOpen && (
          <div className="editor-backdrop" onClick={() => setEditorOpen(false)}>
            <div className="editor-panel" onClick={(e) => e.stopPropagation()}>
              <div
                style={{ fontFamily: "'Instrument Serif', serif", fontSize: fs(22), marginBottom: 20 }}
              >
                {editingId ? 'Edit task' : 'New task'}
              </div>

              <div className="field-label">Task</div>
              <input
                className="field-input"
                style={{ marginBottom: 16 }}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="What needs doing?"
                autoFocus
              />

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <div>
                  <div className="field-label">Subject</div>
                  <input
                    className="field-input"
                    style={{ fontSize: fs(14) }}
                    value={draft.project}
                    onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                    placeholder="e.g. Work, BTI Voice"
                  />
                </div>
                <div>
                  <div className="field-label">Deadline</div>
                  <input
                    type="date"
                    className="field-input date"
                    value={draft.due}
                    onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                  />
                </div>
              </div>

              {subjectPicks.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginTop: -6,
                    marginBottom: 16,
                  }}
                >
                  {subjectPicks.map((s) => (
                    <button
                      key={s.toLowerCase()}
                      className="subject-chip small"
                      title="Click to use · right-click to forget"
                      onClick={() => setDraft({ ...draft, project: s })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        forgetSubject(s);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="field-label">Urgency</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {URG.map((u) => {
                  const sel = draft.urgency === u.key;
                  return (
                    <button
                      key={u.key}
                      className="urgency-seg"
                      style={
                        sel
                          ? {
                              border: `1px solid ${u.color}`,
                              color: u.color,
                              background: 'var(--seg-sel-bg)',
                            }
                          : undefined
                      }
                      onClick={() => setDraft({ ...draft, urgency: u.key })}
                    >
                      {u.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: fs(12), color: 'var(--text-faint)', marginBottom: 22 }}>
                Urgency auto-escalates as the deadline approaches.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {editingId && (
                  <button className="btn-ghost" onClick={deleteTask}>
                    Delete
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn-text" onClick={() => setEditorOpen(false)}>
                  Cancel
                </button>
                <button className="btn-save" onClick={saveDraft}>
                  {editingId ? 'Save' : 'Add task'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings */}
        {settingsOpen && (
          <SettingsModal
            settings={settings}
            onChange={updateSettings}
            deleted={deleted}
            onRestore={restoreTask}
            onPurge={purgeTask}
            onClose={() => setSettingsOpen(false)}
            syncStatus={syncStatus}
            onSyncNow={() => void runSync()}
            onSignIn={signIn}
            onSignUp={signUp}
            onSignOut={signOut}
          />
        )}
      </div>
    </div>
  );
}
