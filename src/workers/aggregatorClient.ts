import AggregatorWorker from './aggregator.worker?worker';
import type {
  Color,
  Filter,
  Game,
  MsgFromMain,
  MsgFromWorker,
  SerializedNode,
  SnapshotRequest,
} from '../types';

export interface SnapshotData {
  color: Color;
  root: SerializedNode;
  totalGames: number;
  focusPath: string[];
  depth: number;
}

export type SnapshotListener = (snap: SnapshotData) => void;
export type ProgressListener = (ingested: number) => void;
export type ErrorListener = (message: string) => void;

export class AggregatorClient {
  private worker: Worker;
  private snapshotListeners = new Set<SnapshotListener>();
  private progressListeners = new Set<ProgressListener>();
  private errorListeners = new Set<ErrorListener>();
  // Keyed by `${color}|${focusPath.join('>')}` — stores prefetched snapshots.
  private prefetchCache = new Map<string, SnapshotData>();
  // Bumped on every reset/ingest. A prefetch result computed against an older
  // game set must not be cached once newer games have arrived.
  private ingestGeneration = 0;
  // FIFO of the generation each in-flight prefetch was sent at. The worker
  // processes messages in order, so its prefetch replies come back in order too.
  private prefetchSendGenerations: number[] = [];

  constructor() {
    this.worker = new AggregatorWorker();
    this.worker.addEventListener('message', (ev: MessageEvent<MsgFromWorker>) => {
      const msg = ev.data;
      if (msg.type === 'snapshot') {
        const snap: SnapshotData = {
          color: msg.color,
          root: msg.root,
          totalGames: msg.totalGames,
          focusPath: msg.focusPath,
          depth: msg.depth,
        };
        if (msg.prefetch) {
          // Match this reply to the generation its request was sent at. Discard
          // if a reset/ingest has happened since — the counts would be stale.
          const sentGen = this.prefetchSendGenerations.shift();
          if (sentGen === this.ingestGeneration) {
            const key = `${msg.color}|${msg.focusPath.join('>')}`;
            this.prefetchCache.set(key, snap);
          }
        } else {
          for (const l of this.snapshotListeners) l(snap);
        }
      } else if (msg.type === 'progress') {
        for (const l of this.progressListeners) l(msg.ingested);
      } else if (msg.type === 'error') {
        for (const l of this.errorListeners) l(msg.message);
      }
    });
  }

  private send(msg: MsgFromMain) {
    this.worker.postMessage(msg);
  }

  reset() {
    this.ingestGeneration++;
    this.prefetchCache.clear();
    this.send({ type: 'reset' });
  }

  ingest(games: Game[], final = false) {
    // Any cached prefetch was computed against the game set loaded *before*
    // these games. Once new games arrive those child counts are stale (e.g. a
    // line prefetched at 23 games when only a slice had streamed in, while the
    // full set has 993), so drop them — the next live snapshot re-prefetches.
    // The generation bump also invalidates any prefetch replies still in flight.
    this.ingestGeneration++;
    this.prefetchCache.clear();
    this.send({ type: 'ingest', games, final });
  }

  requestSnapshot(color: Color, filter: Filter, request: SnapshotRequest) {
    const key = `${color}|${request.focusPath.join('>')}`;
    const cached = this.prefetchCache.get(key);
    if (cached) {
      // Serve the prefetched result immediately (next microtask so callers
      // can register listeners before the callback fires).
      const snap = cached;
      this.prefetchCache.delete(key);
      Promise.resolve().then(() => {
        for (const l of this.snapshotListeners) l(snap);
      });
    } else {
      this.send({ type: 'snapshot', color, filter, request });
    }
  }

  prefetchSnapshot(color: Color, filter: Filter, request: SnapshotRequest) {
    const key = `${color}|${request.focusPath.join('>')}`;
    if (this.prefetchCache.has(key)) return; // already cached
    this.prefetchSendGenerations.push(this.ingestGeneration);
    this.send({ type: 'prefetch', color, filter, request });
  }

  onSnapshot(l: SnapshotListener): () => void {
    this.snapshotListeners.add(l);
    return () => this.snapshotListeners.delete(l);
  }
  onProgress(l: ProgressListener): () => void {
    this.progressListeners.add(l);
    return () => this.progressListeners.delete(l);
  }
  onError(l: ErrorListener): () => void {
    this.errorListeners.add(l);
    return () => this.errorListeners.delete(l);
  }

  terminate() {
    this.worker.terminate();
  }
}
