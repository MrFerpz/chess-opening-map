import { useCallback, useEffect, useRef, useState } from 'react';

export type EvalResult =
  | { type: 'cp'; value: number }
  | { type: 'mate'; value: number };

export function formatEval(e: EvalResult): string {
  if (e.type === 'mate') return e.value > 0 ? `#${e.value}` : `-#${Math.abs(e.value)}`;
  const pawns = e.value / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

export interface PositionEval {
  eval: EvalResult | null;
  bestMove: string | null; // UCI e.g. "e2e4"
}

// Module-level cache shared across all hook instances (survives re-renders).
const cache = new Map<string, PositionEval>();

type Status = 'idle' | 'ready' | 'thinking';

// On touch devices the single-threaded WASM engine competes with the UI for
// CPU cores, so cap each search by time as well as depth. Both limits apply;
// the search stops at whichever is hit first.
const IS_COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const GO_COMMAND = IS_COARSE_POINTER ? 'go depth 12 movetime 400' : 'go depth 15 movetime 2000';

// How long background analysis stays paused after a priority eval is requested
// (i.e. while the user is actively navigating and pieces are animating).
const BACKGROUND_PAUSE_MS = 800;

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [evals, setEvals] = useState<Map<string, PositionEval>>(new Map());
  const readyRef = useRef(false);

  // Queue of pending evaluations — processed one at a time. Priority items
  // (from enqueue) sit at the front; background items (from evaluateAll) at the back.
  const queueRef = useRef<Array<{ fen: string; resolve: () => void; background?: boolean }>>([]);
  const runningRef = useRef(false);
  const runningFenRef = useRef<string | null>(null);
  const pauseUntilRef = useRef(0);
  const pauseTimerRef = useRef<number | null>(null);
  // Latest processNext, for the pause timer to call without a circular reference.
  const processNextRef = useRef<(() => void) | null>(null);

  // Latest depth-N info for the current evaluation.
  const latestInfoRef = useRef<{ eval: EvalResult | null; bestMove: string | null }>({ eval: null, bestMove: null });

  const store = useCallback((fen: string, result: PositionEval) => {
    cache.set(fen, result);
    setEvals((prev) => { const next = new Map(prev); next.set(fen, result); return next; });
  }, []);

  const processNext = useCallback(() => {
    if (!workerRef.current || !readyRef.current || runningRef.current) return;
    const head = queueRef.current[0];
    if (!head) return;

    // Hold background work while the user is navigating so the CPU is free
    // for piece animations; retry once the pause window has passed.
    if (head.background && Date.now() < pauseUntilRef.current) {
      if (pauseTimerRef.current == null) {
        pauseTimerRef.current = window.setTimeout(() => {
          pauseTimerRef.current = null;
          processNextRef.current?.();
        }, Math.max(50, pauseUntilRef.current - Date.now()));
      }
      return;
    }

    const next = queueRef.current.shift()!;

    if (cache.has(next.fen)) {
      // Already cached — seed local state and move on.
      store(next.fen, cache.get(next.fen)!);
      next.resolve();
      processNextRef.current?.();
      return;
    }

    runningRef.current = true;
    runningFenRef.current = next.fen;
    latestInfoRef.current = { eval: null, bestMove: null };
    setStatus('thinking');
    workerRef.current.postMessage(`position fen ${next.fen}`);
    workerRef.current.postMessage(GO_COMMAND);

    const fen = next.fen;
    const resolve = next.resolve;
    // Stockfish scores are always from the side-to-move's perspective; convert to white POV.
    const sideToMove = fen.split(' ')[1];
    const toWhitePov = sideToMove === 'b' ? -1 : 1;

    // Attach a one-shot message handler for this evaluation.
    const handler = (e: MessageEvent<string>) => {
      const line = e.data;

      if (line.startsWith('info') && line.includes('score') && line.includes(' pv ')) {
        const mateMatch = line.match(/\bscore mate (-?\d+)/);
        const cpMatch = line.match(/\bscore cp (-?\d+)/);
        const pvMatch = line.match(/\bpv (\S+)/);
        let ev: EvalResult | null = null;
        if (mateMatch) ev = { type: 'mate', value: parseInt(mateMatch[1]) * toWhitePov };
        else if (cpMatch) ev = { type: 'cp', value: parseInt(cpMatch[1]) * toWhitePov };
        if (ev) latestInfoRef.current = { eval: ev, bestMove: pvMatch?.[1] ?? null };
      }

      if (line.startsWith('bestmove')) {
        workerRef.current?.removeEventListener('message', handler);
        const bmMatch = line.match(/^bestmove (\S+)/);
        const bestMove = bmMatch?.[1] !== '(none)' ? (bmMatch?.[1] ?? null) : null;
        const result: PositionEval = {
          eval: latestInfoRef.current.eval,
          bestMove: latestInfoRef.current.bestMove ?? bestMove,
        };
        if (result.eval) {
          store(fen, result);
        } else {
          // Search was interrupted before producing a score — retry later.
          queueRef.current.push({ fen, resolve: () => {}, background: true });
        }
        resolve();
        runningRef.current = false;
        runningFenRef.current = null;
        setStatus('ready');
        processNextRef.current?.();
      }
    };

    workerRef.current.addEventListener('message', handler);
  }, [store]);

  useEffect(() => {
    processNextRef.current = processNext;
  }, [processNext]);

  useEffect(() => {
    const worker = new Worker('/stockfish-18-lite-single.js');
    workerRef.current = worker;

    const initHandler = (e: MessageEvent<string>) => {
      if (e.data === 'readyok') {
        readyRef.current = true;
        setStatus('ready');
        worker.removeEventListener('message', initHandler);
        processNext();
      }
    };
    worker.addEventListener('message', initHandler);
    worker.postMessage('uci');
    worker.postMessage('isready');

    return () => {
      worker.terminate();
      workerRef.current = null;
      readyRef.current = false;
      runningRef.current = false;
      runningFenRef.current = null;
      if (pauseTimerRef.current != null) {
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
    };
  }, [processNext]);

  // Enqueue a single FEN with priority — returns a promise that resolves when done.
  // Interrupts any in-flight search for a different position and briefly pauses
  // background analysis so navigation stays responsive.
  const enqueue = useCallback((fen: string): Promise<void> => {
    return new Promise((resolve) => {
      if (cache.has(fen)) {
        // Cache hit — no need to interrupt or pause the background analysis.
        store(fen, cache.get(fen)!);
        resolve();
        return;
      }
      queueRef.current.unshift({ fen, resolve });
      pauseUntilRef.current = Date.now() + BACKGROUND_PAUSE_MS;
      if (runningRef.current && runningFenRef.current !== fen) {
        workerRef.current?.postMessage('stop');
      }
      processNext();
    });
  }, [processNext, store]);

  // Evaluate all positions in order (for background analysis).
  const evaluateAll = useCallback((fens: string[]) => {
    for (const fen of fens) {
      if (!cache.has(fen)) {
        queueRef.current.push({ fen, resolve: () => {}, background: true });
      }
    }
    processNext();
  }, [processNext]);

  const getPositionEval = useCallback((fen: string): PositionEval | undefined => {
    if (evals.has(fen)) return evals.get(fen);
    if (cache.has(fen)) return cache.get(fen);
    return undefined;
  }, [evals]);

  return { enqueue, evaluateAll, getPositionEval, status };
}

// Classify a move by the eval drop it caused (from white's perspective).
export type MoveClass = 'brilliant' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null;

function evalToCp(e: EvalResult | null): number {
  if (!e) return 0;
  if (e.type === 'mate') return e.value > 0 ? 10000 : -10000;
  return e.value;
}

// Drop is measured in centipawns from the side to move's perspective.
// Before the move: evalBefore (white POV). After: evalAfter (white POV).
// If it's black's move, we negate to get "from side to move" perspective.
export function classifyMove(
  evalBefore: EvalResult | null | undefined,
  evalAfter: EvalResult | null | undefined,
  isWhiteMove: boolean,
): MoveClass {
  if (!evalBefore || !evalAfter) return null;
  const sign = isWhiteMove ? 1 : -1;
  const before = sign * evalToCp(evalBefore);
  const after = sign * evalToCp(evalAfter);
  const drop = before - after; // positive = got worse for side to move
  if (drop < 0) return 'brilliant'; // eval improved
  if (drop < 10) return 'best';
  if (drop < 25) return 'good';
  if (drop < 60) return 'inaccuracy';
  if (drop < 120) return 'mistake';
  return 'blunder';
}

export const CLASS_COLORS: Record<NonNullable<MoveClass>, string> = {
  brilliant: '#1baca6',
  best:      '#96bc4b',
  good:      '#96bc4b',
  inaccuracy:'#f0c15f',
  mistake:   '#e07b3a',
  blunder:   '#ca3431',
};
