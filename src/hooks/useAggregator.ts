import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Filter, SerializedNode, SnapshotRequest } from '../types';
import { AggregatorClient, type SnapshotData } from '../workers/aggregatorClient';

export interface AggregatorState {
  client: AggregatorClient;
  snapshot: SnapshotData | null;
  progress: number;
  error: string | null;
}

export function useAggregator(
  color: Color,
  filter: Filter,
  request: SnapshotRequest,
): AggregatorState {
  const clientRef = useRef<AggregatorClient | null>(null);
  if (!clientRef.current) clientRef.current = new AggregatorClient();
  const client = clientRef.current;

  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track latest values so listeners only commit relevant snapshots.
  const colorRef = useRef(color);
  colorRef.current = color;
  const focusKeyRef = useRef(request.focusPath.join('>'));
  focusKeyRef.current = request.focusPath.join('>');

  useEffect(() => {
    const offS = client.onSnapshot((s) => {
      if (s.color !== colorRef.current) return;
      if (s.focusPath.join('>') !== focusKeyRef.current) return;
      setSnapshot(s);
    });
    const offP = client.onProgress(setProgress);
    const offE = client.onError(setError);
    return () => {
      offS();
      offP();
      offE();
    };
  }, [client]);

  // Re-request when any of the snapshot inputs change.
  const focusKey = request.focusPath.join('>');
  useEffect(() => {
    client.requestSnapshot(color, filter, request);
    // depth/focusPath/filter changes drive this; request object itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, color, filter, focusKey, request.depth]);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ client, snapshot, progress, error }),
    [client, snapshot, progress, error],
  );
}

export const EMPTY_ROOT: SerializedNode = {
  san: null,
  ply: 0,
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  count: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  oppRatingSum: 0,
  oppRatingCount: 0,
  children: [],
};
