import type { EvalResult } from '../hooks/useCloudEval';
import { formatEval } from '../hooks/useCloudEval';

interface Props {
  eval_: EvalResult | null | undefined;
  height: number;
}

// Map centipawn value to a 0–1 fill ratio (white's advantage).
// Clamps at ±600cp (≈ +6 pawns) so the bar doesn't pin at extremes.
function cpToFill(cp: number): number {
  const CLAMP = 600;
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, cp));
  return (clamped + CLAMP) / (CLAMP * 2);
}

export function EvalBar({ eval_, height }: Props) {
  const barWidth = 14;
  const borderRadius = 7;

  // fill = fraction from bottom that is WHITE (high fill = white advantage).
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

  const whiteHeight = height * fill;
  const blackHeight = height - whiteHeight;

  const evalStr = eval_ === undefined ? '…' : eval_ === null ? '—' : formatEval(eval_);
  const evalColor =
    eval_ == null ? 'var(--text-muted)'
    : isMate ? '#f4d03f'
    : eval_.value > 30 ? 'var(--win)'
    : eval_.value < -30 ? 'var(--loss)'
    : 'var(--text-muted)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
      }}
    >
      {/* The bar — black on top, white on bottom */}
      <div
        title={evalStr}
        style={{
          width: barWidth,
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
        <div
          style={{
            height: blackHeight,
            background: '#1a1d24',
            transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0,
          }}
        />
        {/* White section (bottom) */}
        <div
          style={{
            flex: 1,
            background: isMate
              ? (matePositive ? '#f4d03f' : '#555')
              : '#e8eaf0',
            transition: 'background 0.3s ease',
          }}
        />
      </div>

      {/* Eval label */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: evalColor,
          fontFamily: 'inherit',
          letterSpacing: '-0.01em',
          writingMode: 'horizontal-tb',
          minWidth: 28,
          textAlign: 'center',
        }}
      >
        {evalStr}
      </div>
    </div>
  );
}
