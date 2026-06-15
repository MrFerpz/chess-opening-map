import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square, Move } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { STARTING_FEN } from '../types';
import type { Color, Result, TimeClass } from '../types';
import { EvalBar } from './EvalBar';
import { useStockfish, formatEval, classifyMove, CLASS_COLORS } from '../hooks/useStockfish';
import type { EvalResult, MoveClass } from '../hooks/useStockfish';

// Human-readable label for each move classification.
const CLASS_LABELS: Record<NonNullable<MoveClass>, string> = {
  brilliant: 'Brilliant',
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

export interface GameMeta {
  oppName: string | null;
  oppRating: number | null;
  playedAt: number;
  timeClass: TimeClass;
  result: Result;
}

interface Props {
  focusPath: string[];
  remainingMoves: string[];
  orientation: Color;
  gameId?: string;
  gameMeta?: GameMeta | null;
  onBackToChart: () => void;
  isMobile?: boolean;
  engineEnabled?: boolean;
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

// Sign of an eval from white's POV: >=0 means white is at least equal.
function evalSign(e: EvalResult): number {
  return e.type === 'mate' ? Math.sign(e.value) : Math.sign(e.value) || 1;
}

// Convert UCI move (e2e4) to Arrow object for react-chessboard.
function uciToArrow(uci: string | null, color = '#3ddc97'): Arrow[] {
  if (!uci || uci.length < 4) return [];
  return [{ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color }];
}

// Memoized so eval-cache updates streaming in from the engine don't re-render
// the board (and stutter its piece animation).
const ReplayBoard = React.memo(function ReplayBoard({ fen, orientation, bestMove, size, dimmed, squareStyles, onPieceDrop, onSquareClick }: {
  fen: string;
  orientation: Color;
  bestMove: string | null;
  size: number;
  dimmed: boolean;
  squareStyles: Record<string, React.CSSProperties>;
  onPieceDrop: (args: { sourceSquare: string; targetSquare: string | null }) => boolean;
  onSquareClick: (args: { square: string }) => void;
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0,
      // In explore mode, signal the "scratch" state with an accent ring + glow rather
      // than washing the board (which hurts piece legibility). The glow lives on this
      // outer wrapper so it isn't clipped by the inner board's overflow:hidden.
      boxShadow: dimmed
        ? '0 0 0 2px var(--accent), 0 0 0 6px rgba(61,220,151,0.18), 0 4px 32px rgba(0,0,0,0.5)'
        : '0 4px 32px rgba(0,0,0,0.5)',
      // A faint brightness lift on top of the ring to reinforce the "scratch" state.
      filter: dimmed ? 'brightness(1.03)' : undefined,
      transition: 'box-shadow 0.2s, filter 0.2s',
    }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden' }}>
        <Chessboard
          options={{
            position: fen,
            allowDragging: true,
            showNotation: true,
            boardOrientation: orientation,
            animationDurationInMs: 150,
            id: 'replay-board',
            arrows: uciToArrow(bestMove, '#3ddc97'),
            squareStyles,
            onPieceDrop,
            onSquareClick,
          }}
        />
      </div>
    </div>
  );
});

// A move played by the user while exploring off the mainline.
type FreeMove = { san: string; fen: string };

export function GameReplay({ focusPath, remainingMoves, orientation, gameId, gameMeta, onBackToChart, isMobile, engineEnabled = true }: Props) {
  const boardSize = isMobile ? Math.min(window.innerWidth - 32, 360) : 400;
  const [cursor, setCursor] = useState(0);
  const [boardOrientation, setBoardOrientation] = useState<Color>(orientation);
  // Free-play exploration: moves the user has played off the mainline.
  // While non-empty, the board shows the tip of this stack and the mainline cursor is frozen.
  const [freePlay, setFreePlay] = useState<FreeMove[]>([]);
  // For tap-to-move: the currently selected source square (null = nothing selected).
  const [selected, setSelected] = useState<string | null>(null);
  // The full move list is collapsed by default — it gets long for full games.
  const [movesOpen, setMovesOpen] = useState(false);
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

  const inFreePlay = freePlay.length > 0;
  const mainlineFen = positions[cursor] ?? STARTING_FEN;
  // The position actually on the board: mainline, or the tip of the free-play stack.
  const fen = inFreePlay ? freePlay[freePlay.length - 1].fen : mainlineFen;
  const totalSteps = positions.length - 1;

  const { enqueue, enqueueMultiPV, evaluateAll, getPositionEval, getMultiPv, status } = useStockfish(engineEnabled);

  // Kick off background analysis of all mainline positions as soon as we enter.
  useEffect(() => {
    evaluateAll(positions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.join('|')]);

  // Prioritise the current position: single-PV (fast, for the eval bar) plus a
  // MultiPV search for the top-3 lines panel. MultiPV is only ever run for the
  // one position on the board, so its ~3x cost stays bounded.
  useEffect(() => {
    void enqueue(fen);
    if (engineEnabled) void enqueueMultiPV(fen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  // Try to play a move (from->to) on the current position. Returns true if legal.
  const tryMove = useCallback((from: string, to: string): boolean => {
    const chess = new Chess(fen);
    try {
      const move = chess.move({ from, to, promotion: 'q' });
      if (!move) return false;
      setFreePlay((prev) => [...prev, { san: move.san, fen: chess.fen() }]);
      setSelected(null);
      return true;
    } catch {
      return false;
    }
  }, [fen]);

  // Step one move back: within free-play, pop the stack; otherwise move the mainline cursor.
  const goBack = useCallback(() => {
    setSelected(null);
    if (inFreePlay) setFreePlay((prev) => prev.slice(0, -1));
    else setCursor(c => Math.max(0, c - 1));
  }, [inFreePlay]);

  const goForward = useCallback(() => {
    setSelected(null);
    if (!inFreePlay) setCursor(c => Math.min(totalSteps, c + 1));
  }, [inFreePlay, totalSteps]);

  // Jump back to the mainline (discard exploration).
  const exitFreePlay = useCallback(() => { setFreePlay([]); setSelected(null); }, []);

  // Keyboard nav.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goForward();
      else if (e.key === 'ArrowLeft') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goForward, goBack]);

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
  }, [positions, getPositionEval]);

  // Classify each mainline move by the eval swing it caused. moveClasses[i]
  // describes remainingMoves[i] (the move from positions[i] to positions[i+1]).
  const moveClasses: MoveClass[] = useMemo(() => {
    return remainingMoves.map((_, i) => {
      const before = getPositionEval(positions[i])?.eval;
      const after = getPositionEval(positions[i + 1])?.eval;
      const isWhiteMove = (focusPath.length + i) % 2 === 0;
      return classifyMove(before, after, isWhiteMove);
    });
  }, [remainingMoves, positions, focusPath.length, getPositionEval]);

  // Classification of the move that led to the current mainline position (for the badge near the board).
  const currentMoveClass = !inFreePlay && cursor > 0 ? moveClasses[cursor - 1] : null;

  // Top engine lines (MultiPV) for the current position, converted to SAN with
  // move numbers like "8.Ne2 Ba6 9.Qa4". Limited to the leading few plies.
  const topLines = useMemo(() => {
    const lines = getMultiPv(fen);
    if (!lines?.length) return null;
    // Derive the full-move number / side to move from the FEN fields.
    const parts = fen.split(' ');
    const sideToMove = parts[1]; // 'w' | 'b'
    const fullMoveNo = parseInt(parts[5] ?? '1');

    return lines.slice(0, 3).map((ln) => {
      const chess = new Chess(fen);
      const sans: string[] = [];
      let moveNo = fullMoveNo;
      let white = sideToMove === 'w';
      for (let i = 0; i < ln.moves.length && i < 5; i++) {
        const uci = ln.moves[i];
        try {
          const res = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length === 5 ? uci[4] : undefined });
          if (!res) break;
          if (white) sans.push(`${moveNo}.${res.san}`);
          else { sans.push(res.san); moveNo++; }
          white = !white;
        } catch { break; }
      }
      return { eval: ln.eval, text: sans.join(' '), firstMove: ln.moves[0] ?? null };
    });
  }, [fen, getMultiPv]);

  // Keep the previous lines on screen while the new position is being analysed,
  // so the panel doesn't collapse and shove everything below it around. Storing
  // the last non-null result in state (updated when it changes) lets the panel
  // linger the old lines (dimmed) instead of flashing to "analysing…".
  const [lastLines, setLastLines] = useState<typeof topLines>(null);
  if (topLines && topLines !== lastLines) setLastLines(topLines);
  const displayLines = topLines ?? lastLines;
  const linesStale = !topLines && displayLines != null;

  const resultLabel = gameMeta ? ({ win: 'Won', loss: 'Lost', draw: 'Drew' } as const)[gameMeta.result] : null;
  const resultColor = gameMeta ? ({ win: 'var(--win)', loss: 'var(--loss)', draw: 'var(--text-muted)' } as const)[gameMeta.result] : null;

  // Legal destinations for the selected piece — drives the move dots.
  const legalTargets = useMemo(() => {
    if (!selected) return [] as string[];
    try {
      const chess = new Chess(fen);
      return chess.moves({ square: selected as Square, verbose: true }).map((m: Move) => m.to as string);
    } catch { return []; }
  }, [selected, fen]);

  // Square highlights: selected source + a dot on each legal destination.
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (selected) {
      styles[selected] = { background: 'rgba(61,220,151,0.35)' };
      for (const t of legalTargets) {
        styles[t] = {
          background: 'radial-gradient(circle, rgba(61,220,151,0.55) 22%, transparent 24%)',
        };
      }
    }
    return styles;
  }, [selected, legalTargets]);

  // Tap a piece to select it (showing legal moves), tap a destination to move,
  // tap the same piece again to deselect, tap another own piece to reselect.
  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (selected) {
      if (square === selected) { setSelected(null); return; }
      if (tryMove(selected, square)) return; // legal move played
      // Not a legal target — treat as selecting a different piece if one's there.
    }
    try {
      const chess = new Chess(fen);
      const piece = chess.get(square as Square);
      const turn = chess.turn();
      if (piece && piece.color === turn) setSelected(square);
      else setSelected(null);
    } catch { setSelected(null); }
  }, [selected, fen, tryMove]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }, [tryMove]);

  // On mobile the nav buttons share one row and flex to fit; on desktop they keep their fixed touch size.
  const navRow: React.CSSProperties = {
    display: 'flex', gap: isMobile ? 4 : 8, alignItems: 'center',
    flexWrap: isMobile ? 'nowrap' : 'wrap', justifyContent: 'center',
    width: isMobile ? '100%' : undefined, maxWidth: boardSize,
  };
  const navBtn: React.CSSProperties = isMobile
    ? { ...navBtnStyle, flex: 1, minWidth: 0, padding: '10px 0', fontSize: 16 }
    : navBtnStyle;

  const viewOnLink = gameId && gameUrl(gameId) ? (
    <a href={gameUrl(gameId)} target="_blank" rel="noopener noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: 'var(--surface-raised)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '5px 12px', color: 'var(--text)',
      fontSize: 13, fontFamily: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap',
    }}>
      View on
      <img src={gameId.startsWith('lichess:') ? '/lichesslogo.webp' : '/chesscomlogo.webp'}
        alt={gameId.startsWith('lichess:') ? 'Lichess' : 'Chess.com'}
        style={{ width: 16, height: 16, objectFit: 'contain', filter: gameId.startsWith('lichess:') ? 'invert(1)' : 'none', opacity: 0.85 }} />
    </a>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: isMobile ? '12px 0' : '24px 0', width: '100%' }}>
      {/* Mobile top bar: Back · title · View on */}
      {isMobile ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: boardSize }}>
          <button type="button" onClick={onBackToChart} style={{ ...navBtnStyle, padding: '8px 12px', flexShrink: 0 }}>← Back</button>
          {gameMeta && (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, textAlign: 'center', gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                vs {gameMeta.oppName ?? (gameMeta.oppRating != null ? `${gameMeta.oppRating} rated` : 'unknown')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ textTransform: 'capitalize' }}>{gameMeta.timeClass}</span>
                {' · '}
                <span style={{ color: resultColor ?? undefined, fontWeight: 600 }}>{resultLabel}</span>
              </span>
            </div>
          )}
          {viewOnLink}
        </div>
      ) : (
        gameMeta && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, textAlign: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
              vs {gameMeta.oppName ?? (gameMeta.oppRating != null ? `${gameMeta.oppRating} rated` : 'unknown opponent')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {gameMeta.oppName && gameMeta.oppRating != null && <>{gameMeta.oppRating} rating · </>}
              <span style={{ textTransform: 'capitalize' }}>{gameMeta.timeClass}</span>
              {' · '}
              <span style={{ color: resultColor ?? undefined, fontWeight: 600 }}>{resultLabel}</span>
              {' · '}
              {new Date(gameMeta.playedAt).toLocaleDateString('en-GB')}
            </span>
          </div>
        )
      )}

      {/* Board + eval bar — drag a piece, or tap a piece then tap a destination, to explore your own lines.
          On mobile the eval bar sits horizontally below the board so the board can use the full width. */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: isMobile ? 8 : 14 }}>
        <div style={{ position: 'relative' }}>
          <ReplayBoard
            fen={fen}
            orientation={boardOrientation}
            bestMove={engineEnabled ? bestMove : null}
            size={boardSize}
            dimmed={inFreePlay}
            squareStyles={squareStyles}
            onPieceDrop={onPieceDrop}
            onSquareClick={onSquareClick}
          />
          {/* Classification of the move that reached this position */}
          {engineEnabled && currentMoveClass && (
            <div style={{
              position: 'absolute', top: 8, left: 8,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(17,17,17,0.85)', borderRadius: 6, padding: '4px 9px',
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              color: CLASS_COLORS[currentMoveClass], backdropFilter: 'blur(2px)',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CLASS_COLORS[currentMoveClass] }} />
              {CLASS_LABELS[currentMoveClass]}
            </div>
          )}
        </div>
        {engineEnabled && (
          isMobile
            ? <div style={{ width: boardSize }}><EvalBar eval_={currentEval} height={boardSize} horizontal loading={isLoading && currentEval === undefined} /></div>
            : <EvalBar eval_={currentEval} height={boardSize} loading={isLoading && currentEval === undefined} />
        )}
      </div>

      {/* Top engine lines (MultiPV) for the current position. Height is reserved
          for 3 rows and the previous lines linger (dimmed) while the new position
          is analysed, so the surrounding layout never shifts. */}
      {engineEnabled && (
        <div style={{ width: '100%', maxWidth: boardSize, height: 60, fontSize: 13, fontFamily: 'monospace', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, opacity: linesStale ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          {displayLines
            ? displayLines.map((ln, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, opacity: i === 0 ? 1 : 0.72 }}>
                  <span style={{
                    minWidth: 46, textAlign: 'center', flexShrink: 0,
                    background: ln.eval && evalSign(ln.eval) >= 0 ? '#e8e8e8' : '#262626',
                    color: ln.eval && evalSign(ln.eval) >= 0 ? '#111' : '#e8e8e8',
                    borderRadius: 4, padding: '1px 4px', fontWeight: 700, fontSize: 12,
                  }}>
                    {ln.eval ? formatEval(ln.eval) : '—'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ln.text}</span>
                </div>
              ))
            : <span style={{ color: 'var(--text-dim)' }}>analysing…</span>
          }
        </div>
      )}

      {/* Nav controls — game navigation only; one line, above the eval graph.
          In free-play, ‹/› walk the explored stack and ⏮ returns to the mainline. */}
      <div style={navRow}>
        {!isMobile && <button type="button" onClick={onBackToChart} style={navBtnStyle}>← Back to chart</button>}
        <button type="button" onClick={() => { setSelected(null); if (inFreePlay) exitFreePlay(); else setCursor(0); }} disabled={!inFreePlay && cursor === 0} style={navBtn} title={inFreePlay ? 'Back to game' : 'First move'}>⏮</button>
        <button type="button" onClick={goBack} disabled={!inFreePlay && cursor === 0} style={navBtn}>‹</button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: isMobile ? 44 : 60, textAlign: 'center', flexShrink: 0 }}>
          {inFreePlay ? `+${freePlay.length}` : `${cursor} / ${totalSteps}`}
        </span>
        <button type="button" onClick={goForward} disabled={inFreePlay || cursor === totalSteps} style={navBtn}>›</button>
        <button type="button" onClick={() => { setSelected(null); setCursor(totalSteps); }} disabled={inFreePlay || cursor === totalSteps} style={navBtn}>⏭</button>
        <button type="button" onClick={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')} style={navBtn} title="Flip board">⇅</button>
        {!isMobile && viewOnLink}
      </div>

      {/* Eval graph — reflects the mainline; seeking it leaves free-play. */}
      {engineEnabled && (
        <EvalGraph evals={graphEvals} classes={moveClasses} cursor={cursor} onSeek={(i) => { setFreePlay([]); setCursor(i); }} width={boardSize} />
      )}

      {/* Moves — collapsed by default; toggle to reveal the full move list */}
      <div style={{ width: '100%', maxWidth: boardSize, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setMovesOpen(o => !o)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', padding: '2px 4px',
          }}
        >
          <span style={{ display: 'inline-block', transform: movesOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
          {movesOpen ? 'Hide moves' : `Show moves (${remainingMoves.length})`}
        </button>

        {movesOpen && (
          <div ref={moveListRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: boardSize, justifyContent: 'center', maxHeight: 220, overflowY: 'auto' }}>
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
                    onClick={() => { setFreePlay([]); setCursor(step); }}
                    title={moveClasses[i] ? CLASS_LABELS[moveClasses[i]!] : undefined}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
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
                    {moveClasses[i] && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: CLASS_COLORS[moveClasses[i]!], flexShrink: 0 }} />
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Explored (free-play) variation — always visible while exploring; click a move to rewind to it */}
        {inFreePlay && (
          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, paddingLeft: 8, borderLeft: '2px solid var(--accent)' }}>
            <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>YOU</span>
            {freePlay.map((m, i) => {
              const isTip = i === freePlay.length - 1;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFreePlay((prev) => prev.slice(0, i + 1))}
                  style={{
                    background: isTip ? 'var(--accent)' : 'transparent',
                    color: isTip ? '#111' : 'var(--text)',
                    border: `1px solid ${isTip ? 'var(--accent)' : 'var(--border)'}`,
                    padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 13, fontStyle: 'italic', fontWeight: isTip ? 700 : 400, fontFamily: 'inherit',
                  }}
                >
                  {m.san}
                </button>
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Eval graph ────────────────────────────────────────────────────────────────
function EvalGraph({ evals, classes, cursor, onSeek, width = 520 }: { evals: (number | null)[]; classes?: MoveClass[]; cursor: number; onSeek: (i: number) => void; width?: number }) {
  const W = width, H = 60;
  const mid = H / 2;
  if (evals.length < 2) return null;

  const points = evals.map((v, i) => {
    const x = (i / (evals.length - 1)) * W;
    const y = v == null ? mid : mid - (v / 600) * mid;
    return { x, y, v };
  });

  // Only mark the notable mistakes on the graph to avoid clutter.
  const NOTABLE: Record<string, true> = { inaccuracy: true, mistake: true, blunder: true };

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
      {/* Notable-move markers — classes[i] belongs to the move reaching point i+1 */}
      {classes?.map((c, i) => {
        if (!c || !NOTABLE[c]) return null;
        const p = points[i + 1];
        if (!p) return null;
        return <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={CLASS_COLORS[c]} stroke="#1a1d26" strokeWidth={0.75} />;
      })}
      {/* Cursor line */}
      <line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="var(--accent)" strokeWidth={1.5} opacity={0.8} />
    </svg>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'var(--surface-raised)',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  padding: '10px 16px',
  minHeight: 44,
  minWidth: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
  fontFamily: 'inherit',
  transition: 'background 0.15s',
};
