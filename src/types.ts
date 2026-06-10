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
  // Optional: games cached before this field existed won't have it.
  oppName?: string | null;
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

// ── Rating-band explorer (Lichess Opening Explorer) ──────────────────────────
// A band is identified by its lower bound, which is also the Lichess `ratings`
// bucket value. Bands are 200 wide (Lichess's native bucketing). The top band
// (2400) is open-ended ("2400+").
export interface RatingBand {
  /** Lower bound / Lichess `ratings` bucket value. */
  min: number;
  /** Human label, e.g. "1600–1800" or "2400+". */
  label: string;
}

// Buckets Lichess exposes: 0,1000,1200,1400,1600,1800,2000,2200,2500.
// We surface the meaningful 200-wide bands from 1000 up; 2400 is open-ended.
export const RATING_BANDS: RatingBand[] = [
  { min: 1000, label: '1000–1200' },
  { min: 1200, label: '1200–1400' },
  { min: 1400, label: '1400–1600' },
  { min: 1600, label: '1600–1800' },
  { min: 1800, label: '1800–2000' },
  { min: 2000, label: '2000–2200' },
  { min: 2200, label: '2200–2400' },
  { min: 2400, label: '2400+' },
];

// Speed presets the explorer offers. Each maps to a fixed TimeClass[] that has a
// matching pre-generated data file (public/explorer/<band>-<sorted-speeds>.json),
// so the UI can only request combinations we actually built. Picked one at a time.
export interface SpeedPreset {
  /** Stable id, used only in the UI. */
  id: string;
  label: string;
  speeds: TimeClass[];
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'bullet', label: 'Bullet', speeds: ['bullet'] },
  { id: 'blitz', label: 'Blitz', speeds: ['blitz'] },
  { id: 'rapid', label: 'Rapid', speeds: ['rapid'] },
  // Classical omitted for now — its monthly volume is very sparse and the dump
  // scan to generate it was prohibitively slow. Re-add once its data files
  // exist in public/explorer/ (<band>-classical.json):
  //   npm run gen:explorer -- --month 2026-03 --bands 1000,1200,1400,1600,1800,2000,2200,2400 --speeds classical --per-band 100000 --min-count 15 --depth 14
  // { id: 'classical', label: 'Classical', speeds: ['classical'] },
];

export const DEFAULT_BAND = RATING_BANDS[3]; // 1600–1800
export const DEFAULT_SPEED_PRESET = SPEED_PRESETS[1]; // Blitz
export const DEFAULT_EXPLORER_SPEEDS: TimeClass[] = DEFAULT_SPEED_PRESET.speeds;

export interface ExplorerFilter {
  band: RatingBand;
  speeds: TimeClass[];
}

export type MsgFromMain =
  | { type: 'reset' }
  | { type: 'ingest'; games: Game[]; final?: boolean }
  | {
      type: 'snapshot';
      filter: Filter;
      color: Color;
      request: SnapshotRequest;
    }
  | {
      type: 'prefetch';
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
      prefetch?: boolean;
    }
  | { type: 'error'; message: string };

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Default depth shown outward from the focused ring.
export const DEFAULT_VIEW_DEPTH = 6;
// Default number of most-recent games to include.
export const DEFAULT_GAME_LIMIT = 2000;
