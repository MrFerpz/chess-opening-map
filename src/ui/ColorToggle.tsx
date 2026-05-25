import type { Color } from '../types';

interface Props {
  value: Color;
  onChange: (c: Color) => void;
}

export function ColorToggle({ value, onChange }: Props) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {(['white', 'black'] as const).map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="chip-btn"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#111' : 'var(--text-muted)',
              border: 'none',
              padding: '6px 16px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              textTransform: 'capitalize',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            As {c}
          </button>
        );
      })}
    </div>
  );
}
