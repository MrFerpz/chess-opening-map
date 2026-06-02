import { useState } from 'react';
import type { RatingBand, SpeedPreset } from '../types';
import { RATING_BANDS, SPEED_PRESETS, DEFAULT_BAND, DEFAULT_SPEED_PRESET } from '../types';

interface Props {
  onSubmit: (band: RatingBand, preset: SpeedPreset) => void;
  isMobile?: boolean;
}

export function RatingBandForm({ onSubmit, isMobile }: Props) {
  const [band, setBand] = useState<RatingBand>(DEFAULT_BAND);
  const [preset, setPreset] = useState<SpeedPreset>(DEFAULT_SPEED_PRESET);

  const canSubmit = true;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        width: isMobile ? '100%' : 420,
      }}
    >
      {/* Band picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Rating band</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RATING_BANDS.map((b) => {
            const selected = b.min === band.min;
            return (
              <button
                key={b.min}
                type="button"
                onClick={() => setBand(b)}
                className="chip-btn"
                style={chipStyle(selected)}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Speed preset picker (pick one) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Time control</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p)}
              className="chip-btn"
              style={chipStyle(p.id === preset.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => canSubmit && onSubmit(band, preset)}
        style={{
          background: canSubmit ? 'var(--accent)' : 'var(--surface-raised)',
          color: canSubmit ? '#111' : 'var(--text-dim)',
          border: 'none',
          padding: '11px 28px',
          borderRadius: 8,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 700,
          fontFamily: 'inherit',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = 'var(--accent-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = canSubmit ? 'var(--accent)' : 'var(--surface-raised)'; }}
      >
        Explore
      </button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-dim)',
};

function chipStyle(on: boolean): React.CSSProperties {
  return {
    background: on ? 'var(--accent)' : 'var(--surface-raised)',
    color: on ? '#111' : 'var(--text-muted)',
    border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: on ? 600 : 400,
    transition: 'background 0.15s, color 0.15s, filter 0.15s',
  };
}
