import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, RatingBand, TimeClass } from '../types';
import { ExplorerTreeBuilder } from '../explorer/explorerTree';
import type { SnapshotData } from '../workers/aggregatorClient';

export type ExplorerStatus = 'idle' | 'loading' | 'done' | 'error';

export interface ExplorerState {
  snapshot: SnapshotData | null;
  status: ExplorerStatus;
  error: string | null;
}

export function useExplorer(
  color: Color,
  band: RatingBand,
  speeds: TimeClass[],
  focusPath: string[],
  depth: number,
): ExplorerState {
  const builderRef = useRef<ExplorerTreeBuilder | null>(null);
  if (!builderRef.current) builderRef.current = new ExplorerTreeBuilder();
  const builder = builderRef.current;

  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [status, setStatus] = useState<ExplorerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Stable keys so the effect only re-runs when inputs actually change.
  const focusKey = focusPath.join('>');
  const speedsKey = [...speeds].sort().join(',');

  useEffect(() => {
    const abort = new AbortController();
    setStatus('loading');
    setError(null);

    builder
      .buildSnapshot({
        color,
        focusPath,
        band,
        speeds,
        depth,
        signal: abort.signal,
        onPartial: (snap) => {
          if (abort.signal.aborted) return;
          setSnapshot(snap);
        },
      })
      .then((final) => {
        if (abort.signal.aborted) return;
        setSnapshot(final);
        setStatus('done');
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder, color, band.min, speedsKey, focusKey, depth]);

  return useMemo(
    () => ({ snapshot, status, error }),
    [snapshot, status, error],
  );
}
