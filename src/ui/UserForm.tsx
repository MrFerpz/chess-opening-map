import { useState, type FormEvent } from 'react';
import type { Platform } from '../types';

interface Props {
  onSubmit: (platform: Platform, username: string) => void;
  disabled?: boolean;
  isMobile?: boolean;
}

const PLATFORMS: { id: Platform; label: string; logo: string; invertLogo?: boolean }[] = [
  { id: 'lichess',  label: 'Lichess',   logo: '/lichesslogo.webp',  invertLogo: true },
  { id: 'chesscom', label: 'Chess.com', logo: '/chesscomlogo.webp' },
];

const HISTORY_KEY = 'openingmap-history';
const MAX_HISTORY = 5;

function loadHistory(): Record<Platform, string[]> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}');
  } catch {
    return {} as Record<Platform, string[]>;
  }
}

function saveToHistory(platform: Platform, username: string) {
  const all = loadHistory();
  const list = [username, ...(all[platform] ?? []).filter((u) => u !== username)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...all, [platform]: list }));
}

export function UserForm({ onSubmit, disabled, isMobile }: Props) {
  const [platform, setPlatform] = useState<Platform>('lichess');
  const [username, setUsername] = useState('');
  const [history, setHistory] = useState<Record<Platform, string[]>>(loadHistory);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(username.trim());
  };

  const go = (u: string) => {
    if (!u) return;
    saveToHistory(platform, u);
    setHistory(loadHistory());
    onSubmit(platform, u);
  };

  const suggestions = (history[platform] ?? []).filter(
    (u) => !username.trim() || u.toLowerCase().startsWith(username.trim().toLowerCase()),
  );

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: isMobile ? '100%' : 420 }}>
      {/* Platform picker */}
      <div style={{ display: 'flex', gap: 10 }}>
        {PLATFORMS.map(({ id, label, logo, invertLogo }) => {
          const selected = platform === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPlatform(id)}
              disabled={disabled}
              className={`platform-btn${selected ? ' selected' : ''}`}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '11px 16px',
                borderRadius: 8,
                border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                color: selected ? '#111' : 'inherit',
                background: selected ? 'var(--accent)' : 'var(--surface-raised)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <img
                src={logo}
                alt={label}
                style={{ height: 22, width: 22, objectFit: 'contain', flexShrink: 0, filter: selected ? 'brightness(0)' : invertLogo ? 'invert(1)' : 'none' }}
              />
              <span style={{ color: selected ? '#111' : 'var(--text-muted)', fontSize: 14, fontWeight: selected ? 700 : 400 }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Username + submit */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          disabled={disabled}
          autoFocus
          style={{
            flex: 1,
            background: 'var(--surface-raised)',
            color: 'var(--text)',
            border: '1.5px solid var(--border)',
            borderRadius: 8,
            padding: '11px 14px',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
        <button
          type="submit"
          disabled={disabled || !username.trim()}
          style={{
            background: username.trim() ? 'var(--accent)' : 'var(--surface-raised)',
            color: username.trim() ? '#111' : 'var(--text-dim)',
            border: 'none',
            padding: '11px 28px',
            borderRadius: 8,
            cursor: username.trim() ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'inherit',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { if (username.trim()) e.currentTarget.style.background = 'var(--accent-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = username.trim() ? 'var(--accent)' : 'var(--surface-raised)'; }}
        >
          Go
        </button>
      </div>

      {/* Recent searches — always rendered to avoid layout shift */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -4, minHeight: 30 }}>
          {suggestions.map((u) => (
            <button
              key={u}
              type="button"
              disabled={disabled}
              onClick={() => go(u)}
              style={{
                padding: '4px 12px',
                borderRadius: 20,
                border: '1px solid var(--border)',
                background: 'var(--surface-raised)',
                color: 'var(--text-muted)',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              {u}
            </button>
          ))}
        </div>
    </form>
  );
}
