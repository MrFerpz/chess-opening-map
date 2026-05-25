import type { SerializedNode } from '../types';
import { winRate } from './colorScale';
import { colorForLocalPath } from './colorScale';
import type { EvalResult } from '../hooks/useStockfish';
import { formatEval } from '../hooks/useStockfish';

interface Props {
  node: SerializedNode | null;
  x: number;
  y: number;
  totalGames: number;
  eval_: EvalResult | null | undefined;
  centreX?: number;
}

export function Tooltip({ node, x, y, totalGames, eval_, centreX }: Props) {
  if (!node) return null;

  const wr = Math.round(winRate(node) * 100);
  const pct = totalGames > 0 ? Math.round((node.count / totalGames) * 100) : 0;
  const total = node.wins + node.draws + node.losses;

  const winPct  = total > 0 ? (node.wins  / total) * 100 : 0;
  const drawPct = total > 0 ? (node.draws / total) * 100 : 0;
  const lossPct = total > 0 ? (node.losses / total) * 100 : 0;

  const evalColor =
    eval_ == null ? 'var(--text-muted)'
    : eval_.type === 'mate' ? '#f4d03f'
    : eval_.value > 30 ? 'var(--win)'
    : eval_.value < -30 ? 'var(--loss)'
    : 'var(--text)';

  const evalStr =
    eval_ === undefined ? '…'
    : eval_ === null ? '-'
    : formatEval(eval_);

  const tooltipW = 200;
  const tooltipH = 120;
  const flipX = centreX != null ? x < centreX : x + 14 + tooltipW > window.innerWidth - 8;
  const flipY = y + 14 + tooltipH > window.innerHeight - 8;

  return (
    <div
      style={{
        position: 'fixed',
        left: flipX ? x - tooltipW - 14 : x + 14,
        top: flipY ? y - tooltipH - 14 : y + 14,
        background: 'rgba(13,15,22,0.97)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        padding: '9px 13px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: 'inherit',
        pointerEvents: 'none',
        zIndex: 100,
        minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header row: move + eval */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{node.san ?? 'Start'}</span>
        <span style={{ color: evalColor, fontWeight: 600, fontSize: 13, marginLeft: 12 }}>{evalStr}</span>
      </div>

      {/* Game count */}
      <div style={{ color: 'var(--text-muted)', marginBottom: 7 }}>
        {node.count.toLocaleString()} games ({pct}%)
      </div>

      {/* W/D/L bar + win rate % */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <div style={{ flex: 1, borderRadius: 3, overflow: 'hidden', display: 'flex', height: 6 }}>
          <div style={{ width: `${winPct}%`,  background: 'var(--win)',      transition: 'width 0.2s' }} />
          <div style={{ width: `${drawPct}%`, background: 'var(--text-dim)', transition: 'width 0.2s' }} />
          <div style={{ width: `${lossPct}%`, background: 'var(--loss)',     transition: 'width 0.2s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--win)', flexShrink: 0 }}>{wr}%</span>
      </div>

      {/* W/D/L labels */}
      <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
        <span style={{ color: 'var(--win)' }}>{node.wins.toLocaleString()}W</span>
        <span style={{ color: 'var(--text-muted)' }}>{node.draws.toLocaleString()}D</span>
        <span style={{ color: 'var(--loss)' }}>{node.losses.toLocaleString()}L</span>
      </div>
    </div>
  );
}

export { colorForLocalPath };
