import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { STARTING_FEN } from '../types';
import type { Color } from '../types';
import { EvalBar } from './EvalBar';
import { useStockfish } from '../hooks/useStockfish';

interface Props {
  focusPath: string[];
  remainingMoves: string[];
  orientation: Color;
  gameId?: string;
  onBackToChart: () => void;
  isMobile?: boolean;
}

function gameUrl(gameId: string): string {
  if (gameId.startsWith('lichess:')) return `https://lichess.org/${gameId.slice(8)}`;
  if (gameId.startsWith('chesscom:')) {
    const rest = gameId.slice(9);
    return rest.startsWith('http') ? rest : `https://www.chess.com/game/live/${rest}`;
  }
  return '';
}

type Arrow = { startSquare: string; endSquare: string; color: string };

// Convert UCI move (e2e4) to Arrow object for react-chessboard.
function uciToArrow(uci: string | null, color = '#3ddc97'): Arrow[] {
  if (!uci || uci.length < 4) return [];
  return [{ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color }];
}

export function GameReplay({ focusPath, remainingMoves, orientation, gameId, onBackToChart, isMobile }: Props) {
  const boardSize = isMobile ? Math.min(window.innerWidth - 32, 360) : 400;
  const [cursor, setCursor] = useState(0);
  const [boardOrientation, setBoardOrientation] = useState<Color>(orientation);
  const moveListRef = useRef<HTMLDivElement>(null);

  // Build all positions up front.
  const positions: string[] = useMemo(() => {
    const chess = new Chess();
    for (const san of focusPath) {
      try { chess.move(san); } catch { break; }
    }
    const fens = [chess.fen()];
    for (const san of remainingMoves) {
      try { chess.move(san); fens.push(chess.fen()); } catch { break; }
    }
    return fens;
  }, [focusPath, remainingMoves]);

  const fen = positions[cursor] ?? STARTING_FEN;
  const totalSteps = positions.length - 1;

  const { enqueue, evaluateAll, getPositionEval, status } = useStockfish();

  // Kick off background analysis of all positions as soon as we enter.
  useEffect(() => {
    evaluateAll(positions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.join('|')]);

  // Also ensure current position is prioritised (enqueue jumps the queue).
  useEffect(() => {
    void enqueue(fen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  // Keyboard nav.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setCursor(c => Math.min(totalSteps, c + 1));
      else if (e.key === 'ArrowLeft') setCursor(c => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalSteps]);

  // Scroll current move into view within the move list only (no page scroll).
  useEffect(() => {
    if (moveListRef.current) {
      const active = moveListRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
      if (active) {
        const list = moveListRef.current;
        const listRect = list.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        if (activeRect.bottom > listRect.bottom) {
          list.scrollTop += activeRect.bottom - listRect.bottom + 4;
        } else if (activeRect.top < listRect.top) {
          list.scrollTop -= listRect.top - activeRect.top + 4;
        }
      }
    }
  }, [cursor]);

  const posEval = getPositionEval(fen);
  const currentEval = posEval?.eval;
  const bestMove = posEval?.bestMove ?? null;
  const isLoading = status === 'thinking' || (!posEval && status !== 'idle');

  // Eval graph data — cp values clamped to ±600, from white's perspective.
  const graphEvals: (number | null)[] = useMemo(() => {
    return positions.map((f) => {
      const pe = getPositionEval(f);
      if (!pe?.eval) return null;
      if (pe.eval.type === 'mate') return pe.eval.value > 0 ? 600 : -600;
      return Math.max(-600, Math.min(600, pe.eval.value));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, getPositionEval]);

  // Engine line: PV from best move at current position.
  const engineLine = useMemo(() => {
    if (!posEval?.bestMove) return null;
    try {
      const chess = new Chess(fen);
      const moves: string[] = [];
      let uci = posEval.bestMove;
      for (let i = 0; i < 5; i++) {
        const from = uci.slice(0, 2) as any;
        const to = uci.slice(2, 4) as any;
        const promotion = uci.length === 5 ? uci[4] as any : undefined;
        const result = chess.move({ from, to, promotion });
        if (!result) break;
        moves.push(result.san);
        // We only have the first move from the engine; show what we have.
        break;
      }
      return moves.join(' ');
    } catch { return null; }
  }, [fen, posEval]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0', width: '100%' }}>
      {/* Board + eval bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: boardSize, height: boardSize, borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.5)', flexShrink: 0 }}>
          <Chessboard
            options={{
              position: fen,
              allowDragging: false,
              showNotation: true,
              boardOrientation: boardOrientation,
              animationDurationInMs: 150,
              id: 'replay-board',
              arrows: uciToArrow(bestMove, '#3ddc97'),
            }}
          />
        </div>
        <EvalBar eval_={currentEval} height={boardSize} loading={isLoading && currentEval === undefined} />
      </div>

      {/* Engine line */}
      <div style={{ height: 18, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {isLoading && currentEval === undefined
          ? <span style={{ color: 'var(--text-dim)' }}>analysing…</span>
          : engineLine
          ? <span><span style={{ color: 'var(--accent)', marginRight: 6 }}>Best:</span>{engineLine}</span>
          : null
        }
      </div>

      {/* Eval graph */}
      <EvalGraph evals={graphEvals} cursor={cursor} onSeek={setCursor} width={boardSize} />

      {/* Nav controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" onClick={onBackToChart} style={navBtnStyle}>← Back to chart</button>
        <button type="button" onClick={() => setCursor(0)} disabled={cursor === 0} style={navBtnStyle}>⏮</button>
        <button type="button" onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0} style={navBtnStyle}>‹</button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 60, textAlign: 'center' }}>{cursor} / {totalSteps}</span>
        <button type="button" onClick={() => setCursor(c => Math.min(totalSteps, c + 1))} disabled={cursor === totalSteps} style={navBtnStyle}>›</button>
        <button type="button" onClick={() => setCursor(totalSteps)} disabled={cursor === totalSteps} style={navBtnStyle}>⏭</button>
        <button type="button" onClick={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')} style={navBtnStyle} title="Flip board">⇅</button>
        {gameId && gameUrl(gameId) && (
          <a href={gameUrl(gameId)} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'var(--surface-raised)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '5px 12px', color: 'var(--text)',
            fontSize: 13, fontFamily: 'inherit', textDecoration: 'none', marginLeft: 4,
          }}>
            View on
            <img src={gameId.startsWith('lichess:') ? '/lichesslogo.webp' : '/chesscomlogo.webp'}
              alt={gameId.startsWith('lichess:') ? 'Lichess' : 'Chess.com'}
              style={{ width: 16, height: 16, objectFit: 'contain', filter: gameId.startsWith('lichess:') ? 'invert(1)' : 'none', opacity: 0.85 }} />
          </a>
        )}
      </div>

      {/* Move list */}
      <div ref={moveListRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: boardSize, justifyContent: 'center' }}>
        {remainingMoves.map((san, i) => {
          const step = i + 1;
          const isCurrent = cursor === step;
          const isCurrentOrPast = cursor >= step;
          const globalPly = focusPath.length + i;
          const showNumber = globalPly % 2 === 0;
          const moveNum = Math.floor(globalPly / 2) + 1;

          return (
            <span key={i} data-active={isCurrent} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {showNumber && (
                <span style={{ color: 'var(--text-dim)', fontSize: 12, marginRight: 2 }}>{moveNum}.</span>
              )}
              <button
                type="button"
                data-active={isCurrent}
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
    </div>
  );
}

// ── Eval graph ────────────────────────────────────────────────────────────────
function EvalGraph({ evals, cursor, onSeek, width = 520 }: { evals: (number | null)[]; cursor: number; onSeek: (i: number) => void; width?: number }) {
  const W = width, H = 60;
  const mid = H / 2;
  if (evals.length < 2) return null;

  const points = evals.map((v, i) => {
    const x = (i / (evals.length - 1)) * W;
    const y = v == null ? mid : mid - (v / 600) * mid;
    return { x, y, v };
  });

  // White advantage: region between the eval line and the midline (top half when white winning).
  // Black advantage: region between the eval line and the midline (bottom half when black winning).
  const polyline = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const whiteArea = `${polyline} L${W},${mid} L0,${mid} Z`;
  const blackArea = `${polyline} L${W},${mid} L0,${mid} Z`;

  const cursorX = (cursor / (evals.length - 1)) * W;

  return (
    <svg
      width={W} height={H}
      style={{ cursor: 'crosshair', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        onSeek(Math.round(ratio * (evals.length - 1)));
      }}
    >
      {/* Background — top half white territory, bottom half black territory */}
      <rect width={W} height={mid} fill="#4a4e5e" />
      <rect y={mid} width={W} height={mid} fill="#2a2d3a" />
      {/* White advantage area — fills above midline when white is winning */}
      <path d={whiteArea} fill="#d8dbe8" clipPath="url(#topHalf)" />
      {/* Black advantage area — fills below midline when black is winning */}
      <path d={blackArea} fill="#1a1d26" clipPath="url(#bottomHalf)" />
      {/* Clip paths */}
      <defs>
        <clipPath id="topHalf"><rect width={W} height={mid} /></clipPath>
        <clipPath id="bottomHalf"><rect y={mid} width={W} height={mid} /></clipPath>
      </defs>
      {/* Midline */}
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="#333" strokeWidth={1} />
      {/* Cursor line */}
      <line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="var(--accent)" strokeWidth={1.5} opacity={0.8} />
    </svg>
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
