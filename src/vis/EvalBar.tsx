import type { EvalResult } from '../hooks/useStockfish';
import { formatEval } from '../hooks/useStockfish';

interface Props {
  eval_: EvalResult | null | undefined;
  height: number;
  loading?: boolean;
  horizontal?: boolean;
  hideLabel?: boolean;
}

function cpToFill(cp: number): number {
  const CLAMP = 600;
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, cp));
  return (clamped + CLAMP) / (CLAMP * 2);
}

export function EvalBar({ eval_, height, loading, horizontal, hideLabel }: Props) {
  const barThickness = horizontal ? 14 : 22;
  const borderRadius = horizontal ? 7 : 3;

  let fill = 0.5;
  let isMate = false;
  let matePositive = true;

  if (eval_) {
    if (eval_.type === 'cp') {
      fill = cpToFill(eval_.value);
    } else {
      isMate = true;
      matePositive = eval_.value > 0;
      fill = matePositive ? 1 : 0;
    }
  }

  const evalStr = eval_ === undefined ? '…' : eval_ === null ? '-' : formatEval(eval_);
  const evalColor =
    eval_ == null ? 'var(--text-muted)'
    : isMate ? '#f4d03f'
    : eval_.value > 30 ? 'var(--win)'
    : eval_.value < -30 ? 'var(--loss)'
    : 'var(--text-muted)';

  if (horizontal) {
    const blackPct = (1 - fill) * 100;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', width: '100%' }}>
        <div
          title={evalStr}
          style={{
            flex: 1,
            height: barThickness,
            borderRadius,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            position: 'relative',
            background: isMate ? (matePositive ? '#f4d03f' : '#555') : '#e8eaf0',
            transition: 'all 0.3s ease',
          }}
        >
          {/* Black section grows from left */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${blackPct}%`, background: '#1a1d24', transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)' }} />
        </div>
        {!hideLabel && (
          <div style={{ fontSize: 11, fontWeight: 600, color: evalColor, fontFamily: 'inherit', letterSpacing: '-0.01em', minWidth: 28, textAlign: 'right' }}>
            {loading
              ? <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--border)', borderTopColor: 'var(--text-muted)', animation: 'spin 0.7s linear infinite' }} />
              : eval_ == null ? null : formatEval(eval_)
            }
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const whiteHeight = height * fill;
  const blackHeight = height - whiteHeight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, userSelect: 'none' }}>
      <div
        title={evalStr}
        style={{
          width: barThickness,
          height,
          borderRadius,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          position: 'relative',
          transition: 'all 0.3s ease',
        }}
      >
        {/* Black section (top) */}
        <div style={{ height: blackHeight, background: '#1a1d24', transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)', flexShrink: 0 }} />
        {/* White section (bottom) */}
        <div style={{ flex: 1, background: isMate ? (matePositive ? '#f4d03f' : '#555') : '#e8eaf0', transition: 'background 0.3s ease' }} />
        {/* 0.0 reference line at the vertical midpoint */}
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: 0,
          borderTop: '1px dashed #8b8fa3',
          opacity: 0.85,
          pointerEvents: 'none',
        }} />
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: evalColor, fontFamily: 'inherit', letterSpacing: '-0.01em', minWidth: 28, height: 16, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading
          ? <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--border)', borderTopColor: 'var(--text-muted)', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          : eval_ == null ? null : formatEval(eval_)
        }
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
