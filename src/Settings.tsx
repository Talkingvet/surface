import { useState } from 'react';
import { DEFAULT_SYNC_URL, effectiveSyncUrl } from './sync';
import { type Settings, type View } from './model';
import { FONTS, THEMES, getTheme } from './themes';
import { type DeletedEntry } from './storage';
import { type SyncStatus } from './sync';
import { fs } from './ui';

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

function Row({
  name,
  hint,
  children,
}: {
  name: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div style={{ minWidth: 0 }}>
        <div className="setting-name">{name}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Segs<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg-group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={`seg${o.value === value ? ' sel' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function deletedAgo(deletedAt: number): string {
  const days = Math.floor((Date.now() - deletedAt) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

type SettingsTab = 'general' | 'appearance' | 'account' | 'deleted';

function syncStatusLine(status: SyncStatus): { text: string; color: string } {
  switch (status.state) {
    case 'off':
      return { text: 'Sign in to sync across devices.', color: 'var(--text-faint)' };
    case 'syncing':
      return { text: 'Syncing…', color: 'var(--text-sec)' };
    case 'ok':
      return {
        text: `Synced ${status.at ? new Date(status.at).toLocaleTimeString() : ''}`,
        color: 'var(--text-sec)',
      };
    case 'error':
      return { text: `Sync failed: ${status.message ?? 'unknown error'}`, color: 'var(--urg-0)' };
  }
}

export default function SettingsModal({
  settings,
  onChange,
  deleted,
  onRestore,
  onPurge,
  onClose,
  syncStatus,
  onSyncNow,
  onSignIn,
  onSignUp,
  onSignOut,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  deleted: DeletedEntry[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onClose: () => void;
  syncStatus: SyncStatus;
  onSyncNow: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, invite: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const submitAuth = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      if (authMode === 'signup') await onSignUp(email, password, invite);
      else await onSignIn(email, password);
      setPassword('');
      setInvite('');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const currentKind = getTheme(settings.theme).kind;
  const pickTheme = (id: string) => {
    const kind = getTheme(id).kind;
    set(kind === 'dark' ? { theme: id, lastDark: id } : { theme: id, lastLight: id });
  };
  const setMode = (kind: 'dark' | 'light') => {
    if (kind === currentKind) return;
    pickTheme(kind === 'dark' ? settings.lastDark : settings.lastLight);
  };

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor-panel wide" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: fs(22) }}>Settings</div>
          <div className="seg-group">
            {(
              [
                { value: 'general', label: 'General' },
                { value: 'appearance', label: 'Appearance' },
                { value: 'account', label: 'Account' },
                { value: 'deleted', label: 'Deleted' },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                className={`seg${tab === t.value ? ' sel' : ''}`}
                onClick={() => setTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'general' && (
          <div>
            <Row name="Default view" hint="View shown when the app opens.">
              <Segs<View>
                options={[
                  { value: 'today', label: 'Today' },
                  { value: 'board', label: 'Board' },
                  { value: 'timeline', label: 'Timeline' },
                ]}
                value={settings.defaultView}
                onChange={(v) => set({ defaultView: v })}
              />
            </Row>
            <Row
              name="Escalation window"
              hint="Tasks escalate to Soon within this many days of their deadline."
            >
              <Segs<number>
                options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}d` }))}
                value={settings.escalationDays}
                onChange={(v) => set({ escalationDays: v })}
              />
            </Row>
            <Row name="Show completed tasks" hint="Off hides done tasks everywhere.">
              <Switch on={settings.showCompleted} onChange={(v) => set({ showCompleted: v })} />
            </Row>
          </div>
        )}

        {tab === 'appearance' && (
          <div>
            <Row name="Mode" hint="Quick toggle between your dark and light themes.">
              <Segs<'dark' | 'light'>
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                value={currentKind}
                onChange={setMode}
              />
            </Row>

            <div style={{ padding: '13px 0', borderBottom: '1px solid var(--border-hair)' }}>
              <div className="setting-name" style={{ marginBottom: 10 }}>
                Theme
              </div>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-card${settings.theme === t.id ? ' sel' : ''}`}
                    style={{ background: t.vars['--bg'] }}
                    onClick={() => pickTheme(t.id)}
                  >
                    <div style={{ display: 'flex', gap: 5 }}>
                      {(['--urg-0', '--urg-1', '--urg-2', '--text-sec'] as const).map((k) => (
                        <span
                          key={k}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: t.vars[k],
                          }}
                        />
                      ))}
                    </div>
                    <div
                      style={{ fontSize: fs(12.5), fontWeight: 500, color: t.vars['--text-pri'] }}
                    >
                      {t.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Row name="Font" hint="Typeface for UI text.">
              <Segs<string>
                options={FONTS.map((f) => ({ value: f.id, label: f.name }))}
                value={settings.font}
                onChange={(v) => set({ font: v })}
              />
            </Row>
            <Row name="Text size">
              <Segs<number>
                options={[
                  { value: 0.9, label: 'S' },
                  { value: 1, label: 'M' },
                  { value: 1.1, label: 'L' },
                  { value: 1.2, label: 'XL' },
                ]}
                value={settings.fontScale}
                onChange={(v) => set({ fontScale: v })}
              />
            </Row>
            <Row name="UI scale" hint="Zooms the whole interface.">
              <Segs<number>
                options={[
                  { value: 0.8, label: '80%' },
                  { value: 0.9, label: '90%' },
                  { value: 1, label: '100%' },
                  { value: 1.1, label: '110%' },
                  { value: 1.25, label: '125%' },
                ]}
                value={settings.uiScale}
                onChange={(v) => set({ uiScale: v })}
              />
            </Row>
            <Row name="Keyboard sounds" hint="Soft click while typing.">
              <Switch on={settings.keySounds} onChange={(v) => set({ keySounds: v })} />
            </Row>
            <Row name="Completion chime" hint="Gentle chime when you complete a task.">
              <Switch on={settings.completionSound} onChange={(v) => set({ completionSound: v })} />
            </Row>
          </div>
        )}

        {tab === 'account' && !settings.authToken && (
          <div>
            <div className="setting-hint" style={{ marginTop: 0, marginBottom: 14 }}>
              Sign in to sync your tasks across devices. Everything keeps working offline —
              syncing happens in the background.
            </div>
            <div className="seg-group" style={{ display: 'inline-flex', marginBottom: 16 }}>
              <button
                className={`seg${authMode === 'signin' ? ' sel' : ''}`}
                onClick={() => setAuthMode('signin')}
              >
                Sign in
              </button>
              <button
                className={`seg${authMode === 'signup' ? ' sel' : ''}`}
                onClick={() => setAuthMode('signup')}
              >
                Create account
              </button>
            </div>

            <div className="field-label">Email</div>
            <input
              className="field-input"
              style={{ marginBottom: 14 }}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="field-label">Password</div>
            <input
              className="field-input"
              style={{ marginBottom: 14 }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={authMode === 'signup' ? 'at least 8 characters' : 'your password'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAuth();
              }}
            />
            {authMode === 'signup' && (
              <>
                <div className="field-label">Invite code</div>
                <input
                  className="field-input"
                  style={{ marginBottom: 14 }}
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="ask Paul for the code"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAuth();
                  }}
                />
              </>
            )}
            {authError && (
              <div style={{ fontSize: fs(12.5), color: 'var(--urg-0)', marginBottom: 12 }}>
                {authError}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn-save" onClick={() => void submitAuth()} disabled={authBusy}>
                {authBusy ? '…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </div>

            <div style={{ marginTop: 18, paddingTop: 13, borderTop: '1px solid var(--border-hair)' }}>
              <div className="field-label">Server URL (advanced)</div>
              <input
                className="field-input"
                style={{ fontSize: fs(13) }}
                value={settings.syncUrl}
                onChange={(e) => set({ syncUrl: e.target.value.trim() })}
                placeholder={effectiveSyncUrl('') || DEFAULT_SYNC_URL}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <div className="setting-hint">Leave empty to use the default Surface server.</div>
            </div>
          </div>
        )}

        {tab === 'account' && settings.authToken && (
          <div>
            <Row name="Signed in" hint={settings.authEmail}>
              <button className="btn-ghost" onClick={onSignOut}>
                Sign out
              </button>
            </Row>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '13px 0',
              }}
            >
              <div style={{ fontSize: fs(12.5), color: syncStatusLine(syncStatus).color }}>
                {syncStatusLine(syncStatus).text}
              </div>
              <button className="btn-ghost safe" onClick={onSyncNow}>
                Sync now
              </button>
            </div>
            <div className="setting-hint" style={{ marginTop: 6 }}>
              Tasks and Recently Deleted sync across your devices. Appearance stays per-device.
              Signing out keeps your tasks on this device.
            </div>
          </div>
        )}

        {tab === 'deleted' && (
          <div>
            <div className="setting-hint" style={{ marginBottom: 12, marginTop: 0 }}>
              Deleted tasks stay here for 30 days, then disappear for good.
            </div>
            {deleted.filter((e) => !e.purged).length === 0 ? (
              <div className="empty-box">Nothing here — deleted tasks appear here.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {deleted.filter((e) => !e.purged).map((e) => (
                  <div key={e.task.id} className="deleted-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: fs(14),
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {e.task.title}
                      </div>
                      <div style={{ marginTop: 2, fontSize: fs(12), color: 'var(--text-ter)' }}>
                        {e.task.project ? `${e.task.project} · ` : ''}deleted {deletedAgo(e.deletedAt)}
                      </div>
                    </div>
                    <button className="btn-ghost safe" onClick={() => onRestore(e.task.id)}>
                      Restore
                    </button>
                    <button
                      className="btn-text"
                      style={{ padding: '9px 6px' }}
                      title="Delete forever"
                      onClick={() => onPurge(e.task.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-save" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
