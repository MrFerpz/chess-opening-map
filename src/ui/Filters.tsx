import type { Filter, TimeClass } from '../types';

interface Props {
  value: Filter;
  onChange: (f: Filter) => void;
}

const TIME_CLASSES: TimeClass[] = ['bullet', 'blitz', 'rapid', 'classical'];
const LIMIT_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '500',   value: 500 },
  { label: '2,000', value: 2000 },
  { label: '5,000', value: 5000 },
  { label: 'All',   value: null },
];

export function Filters({ value, onChange }: Props) {
  const toggle = (tc: TimeClass) => {
    const set = new Set(value.timeClasses);
    if (set.has(tc)) set.delete(tc); else set.add(tc);
    onChange({ ...value, timeClasses: Array.from(set) });
  };

  const setDate = (key: 'from' | 'to', v: string) => {
    onChange({ ...value, [key]: v ? new Date(v).getTime() : undefined });
  };

  const setLimit = (lim: number | null) => onChange({ ...value, limit: lim });

  const fmt = (n?: number) => (n ? new Date(n).toISOString().slice(0, 10) : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Time class chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TIME_CLASSES.map((tc) => (
          <button key={tc} type="button" onClick={() => toggle(tc)} className="chip-btn"
            style={chipStyle(value.timeClasses.includes(tc))}>
            {tc}
          </button>
        ))}
      </div>

      {/* Game limit chips */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 2 }}>
          Last
        </span>
        {LIMIT_OPTIONS.map((opt) => (
          <button key={opt.label} type="button" onClick={() => setLimit(opt.value)} className="chip-btn"
            style={chipStyle(value.limit === opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={labelStyle}>
          From
          <input type="date" value={fmt(value.from)} onChange={(e) => setDate('from', e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          To
          <input type="date" value={fmt(value.to)} onChange={(e) => setDate('to', e.target.value)} style={inputStyle} />
        </label>
      </div>

      {/* Opponent rating range */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Opp rating
        </span>
        <label style={labelStyle}>
          <input
            type="number"
            placeholder="Min"
            min={0}
            max={3500}
            value={value.oppRatingMin ?? ''}
            onChange={(e) => onChange({ ...value, oppRatingMin: e.target.value ? Number(e.target.value) : undefined })}
            style={{ ...inputStyle, width: 62 }}
          />
        </label>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>–</span>
        <label style={labelStyle}>
          <input
            type="number"
            placeholder="Max"
            min={0}
            max={3500}
            value={value.oppRatingMax ?? ''}
            onChange={(e) => onChange({ ...value, oppRatingMax: e.target.value ? Number(e.target.value) : undefined })}
            style={{ ...inputStyle, width: 62 }}
          />
        </label>
      </div>
    </div>
  );
}

function chipStyle(on: boolean): React.CSSProperties {
  return {
    background: on ? 'var(--accent)' : 'var(--surface-raised)',
    color: on ? '#111' : 'var(--text-muted)',
    border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
    padding: '4px 10px',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: on ? 600 : 400,
    textTransform: 'capitalize',
    transition: 'background 0.15s, color 0.15s, filter 0.15s',
  };
}

const labelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-raised)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
};
