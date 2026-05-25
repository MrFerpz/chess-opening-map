import { useCallback, useEffect, useRef, useState } from 'react';
import type { SerializedNode } from '../types';

export type EvalResult =
  | { type: 'cp'; value: number }
  | { type: 'mate'; value: number };

// Module-level cache shared across renders.
const cache = new Map<string, EvalResult | null>();

// Track in-flight fetches so concurrent callers don't double-fetch the same FEN.
const inflight = new Set<string>();

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// Fetch a single FEN from Lichess cloud eval with exponential backoff on 429.
// Returns null if genuinely not found, or after retries are exhausted.
async function fetchCloud(fen: string, signal?: AbortSignal): Promise<EvalResult | null> {
  const delays = [0, 1000, 2000, 4000];
  for (const delay of delays) {
    if (signal?.aborted) return null;
    if (delay > 0) await sleep(delay);
    if (signal?.aborted) return null;
    try {
      const timeout = AbortSignal.timeout(5000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const r = await fetch(
        `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`,
        { signal: combined },
      );
      if (r.status === 404) return null;
      if (r.status === 429) continue; // retry after backoff
      if (!r.ok) return null;
      const data = await r.json();
      if (!data?.pvs?.length) return null;
      const pv = data.pvs[0];
      if (pv.cp !== undefined) return { type: 'cp', value: pv.cp };
      if (pv.mate !== undefined) return { type: 'mate', value: pv.mate };
      return null;
    } catch {
      return null; // aborted or network error — give up
    }
  }
  return null; // exhausted retries
}

export function useEvalCache(_root: SerializedNode | null) {
  // Map from FEN → eval (undefined = not yet fetched, null = unavailable).
  const [evals, setEvals] = useState<Map<string, EvalResult | null>>(new Map());
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverAbortRef = useRef<AbortController | null>(null);

  // Store result into both module cache and state.
  const store = useCallback((fen: string, result: EvalResult | null) => {
    cache.set(fen, result);
    setEvals((prev) => {
      const next = new Map(prev);
      next.set(fen, result);
      return next;
    });
  }, []);

  // Debounced hover: fetch after 400ms pause, cancel on leave.
  const onHover = useCallback((fen: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (cache.has(fen) || inflight.has(fen)) return;
    hoverTimerRef.current = setTimeout(async () => {
      if (cache.has(fen) || inflight.has(fen)) return;
      hoverAbortRef.current?.abort();
      const ctrl = new AbortController();
      hoverAbortRef.current = ctrl;
      inflight.add(fen);
      const result = await fetchCloud(fen, ctrl.signal);
      inflight.delete(fen);
      if (!ctrl.signal.aborted) store(fen, result);
    }, 200);
  }, [store]);

  const onLeave = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    hoverAbortRef.current?.abort();
  }, []);

  const getEval = useCallback((fen: string): EvalResult | null | undefined => {
    if (evals.has(fen)) return evals.get(fen);
    if (cache.has(fen)) return cache.get(fen);
    return undefined; // not fetched yet
  }, [evals]);

  return { getEval, onHover, onLeave };
}

export function formatEval(e: EvalResult): string {
  if (e.type === 'mate') return e.value > 0 ? `#${e.value}` : `-#${Math.abs(e.value)}`;
  const pawns = e.value / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}
