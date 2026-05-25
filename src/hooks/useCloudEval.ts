import { useCallback, useEffect, useRef, useState } from 'react';
import type { SerializedNode } from '../types';

export type EvalResult =
  | { type: 'cp'; value: number }
  | { type: 'mate'; value: number };

// Module-level cache shared across renders.
const cache = new Map<string, EvalResult | null>();

// Fetch a single FEN from Lichess cloud eval. Returns null if not found.
async function fetchCloud(fen: string, signal?: AbortSignal): Promise<EvalResult | null> {
  try {
    const r = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`,
      { signal },
    );
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.pvs?.length) return null;
    const pv = data.pvs[0];
    if (pv.cp !== undefined) return { type: 'cp', value: pv.cp };
    if (pv.mate !== undefined) return { type: 'mate', value: pv.mate };
    return null;
  } catch {
    return null;
  }
}

// Walk tree BFS, collect top-N children by count at each node up to maxDepth rings.
function topFens(root: SerializedNode, topN: number, maxDepth: number): string[] {
  const fens: string[] = [];
  const queue: { node: SerializedNode; depth: number }[] = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const sorted = [...node.children].sort((a, b) => b.count - a.count);
    for (const child of sorted.slice(0, topN)) {
      if (child.fen) fens.push(child.fen);
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return [...new Set(fens)];
}

export function useEvalCache(root: SerializedNode | null) {
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

  // Pre-fetch top-2 lines at each ring whenever rootData changes.
  useEffect(() => {
    if (!root) return;
    const fens = topFens(root, 2, 6);
    const uncached = fens.filter((f) => !cache.has(f));
    if (uncached.length === 0) return;

    // Seed state with already-cached values immediately.
    const known = fens.filter((f) => cache.has(f));
    if (known.length > 0) {
      setEvals((prev) => {
        const next = new Map(prev);
        for (const f of known) next.set(f, cache.get(f)!);
        return next;
      });
    }

    // Fetch uncached ones sequentially (avoid hammering the API).
    let cancelled = false;
    (async () => {
      for (const fen of uncached) {
        if (cancelled) break;
        if (cache.has(fen)) continue; // may have been filled by a concurrent hover
        const result = await fetchCloud(fen);
        if (!cancelled) store(fen, result);
      }
    })();
    return () => { cancelled = true; };
  }, [root, store]);

  // Debounced hover: fetch after 400ms pause, cancel on leave.
  const onHover = useCallback((fen: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (cache.has(fen)) return; // already have it
    hoverTimerRef.current = setTimeout(async () => {
      if (cache.has(fen)) return;
      hoverAbortRef.current?.abort();
      const ctrl = new AbortController();
      hoverAbortRef.current = ctrl;
      const result = await fetchCloud(fen, ctrl.signal);
      store(fen, result);
    }, 400);
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
