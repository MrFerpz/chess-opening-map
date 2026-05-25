import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvalResult } from './useCloudEval';

export interface PositionEval {
  eval: EvalResult | null;
  bestMove: string | null; // UCI e.g. "e2e4"
}

// Module-level cache shared across all hook instances (survives re-renders).
const cache = new Map<string, PositionEval>();

type Status = 'idle' | 'ready' | 'thinking';

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [evals, setEvals] = useState<Map<string, PositionEval>>(new Map());
  const readyRef = useRef(false);

  // Queue of pending evaluations — processed one at a time.
  const queueRef = useRef<Array<{ fen: string; resolve: () => void }>>([]);
  const runningRef = useRef(false);

  // Latest depth-N info for the current evaluation.
  const latestInfoRef = useRef<{ eval: EvalResult | null; bestMove: string | null }>({ eval: null, bestMove: null });

  const store = useCallback((fen: string, result: PositionEval) => {
    cache.set(fen, result);
    setEvals((prev) => { const next = new Map(prev); next.set(fen, result); return next; });
  }, []);

  const processNext = useCallback(() => {
    if (!workerRef.current || !readyRef.current || runningRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;

    if (cache.has(next.fen)) {
      // Already cached — seed local state and move on.
      store(next.fen, cache.get(next.fen)!);
      next.resolve();
      processNext();
      return;
    }

    runningRef.current = true;
    latestInfoRef.current = { eval: null, bestMove: null };
    setStatus('thinking');
    workerRef.current.postMessage(`position fen ${next.fen}`);
    workerRef.current.postMessage('go depth 15');

    const fen = next.fen;
    const resolve = next.resolve;

    // Attach a one-shot message handler for this evaluation.
    const handler = (e: MessageEvent<string>) => {
      const line = e.data;

      if (line.startsWith('info') && line.includes('score') && line.includes(' pv ')) {
        const mateMatch = line.match(/\bscore mate (-?\d+)/);
        const cpMatch = line.match(/\bscore cp (-?\d+)/);
        const pvMatch = line.match(/\bpv (\S+)/);
        let ev: EvalResult | null = null;
        if (mateMatch) ev = { type: 'mate', value: parseInt(mateMatch[1]) };
        else if (cpMatch) ev = { type: 'cp', value: parseInt(cpMatch[1]) };
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
        store(fen, result);
        resolve();
        runningRef.current = false;
        setStatus('ready');
        processNext();
      }
    };

    workerRef.current.addEventListener('message', handler);
  }, [store]);

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
    };
  }, [processNext]);

  // Enqueue a single FEN — returns a promise that resolves when done.
  const enqueue = useCallback((fen: string): Promise<void> => {
    return new Promise((resolve) => {
      queueRef.current.push({ fen, resolve });
      processNext();
    });
  }, [processNext]);

  // Evaluate all positions in order (for background analysis).
  const evaluateAll = useCallback((fens: string[]) => {
    for (const fen of fens) {
      if (!cache.has(fen)) {
        queueRef.current.push({ fen, resolve: () => {} });
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
