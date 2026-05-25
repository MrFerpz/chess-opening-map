import { useCallback, useState } from 'react';
import type { Color, Filter, Game, Platform, SnapshotRequest } from '../types';
import { fetchGames } from '../api/platform';
import { getSyncMeta, listGames, putGames, setSyncMeta } from '../store/cache';
import type { AggregatorClient } from '../workers/aggregatorClient';

export type SyncStatus = 'idle' | 'loading-cache' | 'fetching' | 'done' | 'error';

export interface SyncRunState {
  status: SyncStatus;
  fromCache: number;
  fetched: number;
  error: string | null;
}

interface StartArgs {
  client: AggregatorClient;
  platform: Platform;
  username: string;
  color: Color;
  filter: Filter;
  request: SnapshotRequest;
  // Max total games to fetch+cache. null = unlimited.
  limit: number | null;
}

const BATCH = 50;

export function useGameSync() {
  const [state, setState] = useState<SyncRunState>({
    status: 'idle',
    fromCache: 0,
    fetched: 0,
    error: null,
  });

  const start = useCallback(async ({ client, platform, username, color, filter, request, limit }: StartArgs) => {
    setState({ status: 'loading-cache', fromCache: 0, fetched: 0, error: null });
    try {
      client.reset();
      const cached = await listGames(platform, username);
      if (cached.length > 0) {
        client.ingest(cached as Game[]);
      }
      setState((s) => ({ ...s, fromCache: cached.length, status: 'fetching' }));

      const meta = await getSyncMeta(platform, username);
      const since = meta?.lastPlayedAt;

      // How many more games we're willing to fetch on top of what's cached.
      const fetchBudget = limit != null ? Math.max(0, limit - cached.length) : Infinity;

      let batch: Game[] = [];
      let fetched = 0;
      let newestPlayedAt = since ?? 0;
      const cachedIds = new Set(cached.map((g) => g.id));

      for await (const g of fetchGames(platform, username, since)) {
        if (fetched >= fetchBudget) break;
        if (cachedIds.has(g.id)) continue;
        batch.push(g);
        fetched++;
        if (g.playedAt > newestPlayedAt) newestPlayedAt = g.playedAt;
        if (batch.length >= BATCH) {
          await putGames(platform, username, batch);
          client.ingest(batch);
          setState((s) => ({ ...s, fetched }));
          batch = [];
        }
      }
      if (batch.length > 0) {
        await putGames(platform, username, batch);
        client.ingest(batch);
      }
      client.requestSnapshot(color, filter, request);
      if (newestPlayedAt > 0) {
        await setSyncMeta(platform, username, newestPlayedAt);
      }
      setState((s) => ({ ...s, status: 'done', fetched }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  return { state, start };
}
