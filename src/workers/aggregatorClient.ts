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

  constructor() {
    this.worker = new AggregatorWorker();
    this.worker.addEventListener('message', (ev: MessageEvent<MsgFromWorker>) => {
      const msg = ev.data;
      if (msg.type === 'snapshot') {
        for (const l of this.snapshotListeners) l(msg);
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
    this.send({ type: 'reset' });
  }

  ingest(games: Game[], final = false) {
    this.send({ type: 'ingest', games, final });
  }

  requestSnapshot(color: Color, filter: Filter, request: SnapshotRequest) {
    this.send({ type: 'snapshot', color, filter, request });
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
