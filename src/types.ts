export type Platform = 'chesscom' | 'lichess';
export type Color = 'white' | 'black';
export type Result = 'win' | 'loss' | 'draw';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface Game {
  id: string;
  platform: Platform;
  username: string;
  playedAt: number;
  timeClass: TimeClass;
  userColor: Color;
  result: Result;
  userRating: number | null;
  oppRating: number | null;
  eco?: string;
  moves: string[];
}

export interface CachedGameRow extends Game {
  syncedAt: number;
  cacheKey: string;
}

export interface SyncMeta {
  key: string;
  lastPlayedAt: number;
  lastSyncedAt: number;
}

export interface SerializedNode {
  san: string | null;
  ply: number;
  fen: string;
  count: number;
  wins: number;
  draws: number;
  losses: number;
  oppRatingSum: number;
  oppRatingCount: number;
  children: SerializedNode[];
}

export interface Filter {
  timeClasses: TimeClass[];
  from?: number;
  to?: number;
  // null = unlimited (all cached games)
  limit: number | null;
  oppRatingMin?: number;
  oppRatingMax?: number;
}

export interface SnapshotRequest {
  focusPath: string[];
  depth: number;
}

export type MsgFromMain =
  | { type: 'reset' }
  | { type: 'ingest'; games: Game[]; final?: boolean }
  | {
      type: 'snapshot';
      filter: Filter;
      color: Color;
      request: SnapshotRequest;
    };

export type MsgFromWorker =
  | { type: 'progress'; ingested: number }
  | {
      type: 'snapshot';
      color: Color;
      root: SerializedNode;
      totalGames: number;
      focusPath: string[];
      depth: number;
    }
  | { type: 'error'; message: string };

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Default depth shown outward from the focused ring.
export const DEFAULT_VIEW_DEPTH = 6;
// Default number of most-recent games to include.
export const DEFAULT_GAME_LIMIT = 2000;
