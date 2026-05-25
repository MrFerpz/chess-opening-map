import React, { useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { STARTING_FEN } from '../types';
import type { Color } from '../types';
import { EvalBar } from './EvalBar';
import { useEvalCache } from '../hooks/useCloudEval';
import type { SerializedNode } from '../types';

interface Props {
  focusPath: string[];       // moves already played to reach this point
  remainingMoves: string[];  // moves left in the single game
  orientation: Color;
  onBack: () => void;        // pop one move
  onBackToChart: () => void; // return to last position with >1 game
}

export function GameReplay({ focusPath, remainingMoves, orientation, onBack, onBackToChart }: Props) {
  const [cursor, setCursor] = useState(0); // 0 = focus position, N = N moves into remainingMoves

  // Build positions for each step
  const positions: string[] = (() => {
    const chess = new Chess();
    for (const san of focusPath) {
      try { chess.move(san); } catch { break; }
    }
    const fens = [chess.fen()];
    for (const san of remainingMoves) {
      try {
        chess.move(san);
        fens.push(chess.fen());
      } catch { break; }
    }
    return fens;
  })();

  const fen = positions[cursor] ?? STARTING_FEN;
  const totalSteps = positions.length - 1;

  // Build a minimal root node for useEvalCache (it only needs fen)
  const fakeRoot: SerializedNode = {
    san: null, ply: 0, fen, count: 1,
    wins: 0, draws: 0, losses: 0,
    oppRatingSum: 0, oppRatingCount: 0, children: [],
  };
  const evalCache = useEvalCache(fakeRoot);
  const currentEval = evalCache.getEval(fen);

  // Trigger eval fetch when cursor moves
  React.useEffect(() => {
    evalCache.onHover(fen);
    return () => evalCache.onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
      {/* Board + eval bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 400, height: 400,
          borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
          flexShrink: 0,
        }}>
          <Chessboard
            options={{
              position: fen,
              allowDragging: false,
              showNotation: true,
              boardOrientation: orientation,
              animationDurationInMs: 150,
              id: 'replay-board',
            }}
          />
        </div>
        <EvalBar eval_={currentEval} height={400} />
      </div>

      {/* Move list */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        maxWidth: 500,
        justifyContent: 'center',
      }}>
        {remainingMoves.map((san, i) => {
          const step = i + 1;
          const isCurrentOrPast = cursor >= step;
          const isCurrent = cursor === step;
          const globalPly = focusPath.length + i;
          const showNumber = globalPly % 2 === 0;
          const moveNum = Math.floor(globalPly / 2) + 1;

          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {showNumber && (
                <span style={{ color: 'var(--text-dim)', fontSize: 12, marginRight: 2 }}>
                  {moveNum}.
                </span>
              )}
              <button
                type="button"
                onClick={() => setCursor(step)}
                style={{
                  background: isCurrent ? 'var(--accent)' : isCurrentOrPast ? 'var(--surface-raised)' : 'transparent',
                  color: isCurrent ? '#111' : isCurrentOrPast ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                  padding: '3px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isCurrent ? 700 : 400,
                  fontFamily: 'inherit',
                  transition: 'background 0.1s, color 0.1s',
                }}
              >
                {san}
              </button>
            </span>
          );
        })}
      </div>

      {/* Nav controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" onClick={onBackToChart} style={navBtnStyle}>
          ← Back to chart
        </button>
        <button type="button" onClick={onBack} style={navBtnStyle}>
          ‹ Previous move
        </button>
        <button type="button" onClick={() => setCursor(0)} disabled={cursor === 0} style={navBtnStyle}>
          ⏮
        </button>
        <button type="button" onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0} style={navBtnStyle}>
          ‹
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 60, textAlign: 'center' }}>
          {cursor} / {totalSteps}
        </span>
        <button type="button" onClick={() => setCursor(c => Math.min(totalSteps, c + 1))} disabled={cursor === totalSteps} style={navBtnStyle}>
          ›
        </button>
        <button type="button" onClick={() => setCursor(totalSteps)} disabled={cursor === totalSteps} style={navBtnStyle}>
          ⏭
        </button>
      </div>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'var(--surface-raised)',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  padding: '5px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'background 0.15s',
};
