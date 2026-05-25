import { useState, type FormEvent } from 'react';
import type { Platform } from '../types';

interface Props {
  onSubmit: (platform: Platform, username: string) => void;
  disabled?: boolean;
}

const PLATFORMS: { id: Platform; label: string; logo: string; invertLogo?: boolean }[] = [
  { id: 'lichess',  label: 'Lichess',   logo: '/lichesslogo.webp',  invertLogo: true },
  { id: 'chesscom', label: 'Chess.com', logo: '/chesscomlogo.webp' },
];

const FORM_WIDTH = 420;

export function UserForm({ onSubmit, disabled }: Props) {
  const [platform, setPlatform] = useState<Platform>('lichess');
  const [username, setUsername] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) return;
    onSubmit(platform, u);
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: FORM_WIDTH }}>
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
    </form>
  );
}
