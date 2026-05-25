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
          const key = `${msg.color}|${msg.focusPath.join('>')}`;
          this.prefetchCache.set(key, snap);
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
    this.prefetchCache.clear();
    this.send({ type: 'reset' });
  }

  ingest(games: Game[], final = false) {
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
