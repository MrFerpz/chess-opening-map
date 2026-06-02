import { Chess } from 'chess.js';
import type { Color, RatingBand, SerializedNode, TimeClass } from '../types';
import { STARTING_FEN } from '../types';
import type { SnapshotData } from '../workers/aggregatorClient';

// ── Static pre-aggregated opening trees ──────────────────────────────────────
// Data is generated offline by scripts/gen-explorer-data.mjs from Lichess's CC0
// monthly database dumps and shipped as static JSON in public/explorer/. There
// is NO live network/API at runtime — we load one band file, cache it, and slice
// subtrees locally as the user navigates. (Lichess locked the live Opening
// Explorer behind login in early 2026, hence the static approach.)

// Shape of a node in the generated JSON. wins/draws/losses are stored from
// WHITE's perspective; avgRating is the average player rating; no FEN (we
// recompute FENs client-side via chess.js).
interface StaticNode {
  san: string | null;
  ply: number;
  count: number;
  wins: number;   // white wins
  draws: number;
  losses: number; // black wins
  avgRating: number;
  children: StaticNode[];
}

interface BuildArgs {
  color: Color;
  /** SAN moves from the start to the focused position. */
  focusPath: string[];
  band: RatingBand;
  speeds: TimeClass[];
  depth: number;
  signal?: AbortSignal;
  /** Kept for API symmetry with the old streaming builder; called once here. */
  onPartial?: (snap: SnapshotData) => void;
}

function fileFor(band: RatingBand, speeds: TimeClass[]): string {
  const tag = [...speeds].sort().join('-');
  return `${import.meta.env.BASE_URL}explorer/${band.min}-${tag}.json`;
}

export class ExplorerTreeBuilder {
  // Per (band|speeds) loaded root, cached for the session.
  private trees = new Map<string, Promise<StaticNode | null>>();

  private loadTree(band: RatingBand, speeds: TimeClass[]): Promise<StaticNode | null> {
    const key = fileFor(band, speeds);
    let p = this.trees.get(key);
    if (!p) {
      p = fetch(key)
        .then((r) => (r.ok ? (r.json() as Promise<StaticNode>) : null))
        .catch(() => null);
      this.trees.set(key, p);
    }
    return p;
  }

  async buildSnapshot(args: BuildArgs): Promise<SnapshotData> {
    const { color, focusPath, band, speeds, depth, signal, onPartial } = args;

    const root = await this.loadTree(band, speeds);
    if (signal?.aborted) return emptySnapshot(color, focusPath, depth);
    if (!root) {
      // No data file for this band/speed combination.
      const snap = emptySnapshot(color, focusPath, depth);
      onPartial?.(snap);
      return snap;
    }

    // Navigate to the focused position within the static tree.
    let focusNode: StaticNode = root;
    let focusOk = true;
    const chess = new Chess();
    for (const san of focusPath) {
      const next: StaticNode | undefined = focusNode.children.find((c) => c.san === san);
      if (!next || !safeApply(chess, san)) { focusOk = false; break; }
      focusNode = next;
    }

    if (!focusOk) {
      const snap = emptySnapshot(color, focusPath, depth);
      onPartial?.(snap);
      return snap;
    }

    const focusFen = chess.fen();
    const serialized = convert(focusNode, color, chess, depth, focusFen);
    const snap: SnapshotData = {
      color,
      root: serialized,
      totalGames: serialized.count,
      focusPath: [...focusPath],
      depth,
    };
    onPartial?.(snap);
    return snap;
  }
}

// ── conversion: StaticNode -> SerializedNode (the Sunburst's shape) ───────────
// Flips W/L per color, recomputes FENs via chess.js, folds avgRating into the
// oppRating fields so the existing tooltip's rating line renders unchanged.
function convert(
  node: StaticNode,
  color: Color,
  chess: Chess,
  depthRemaining: number,
  fen: string,
): SerializedNode {
  const wins = color === 'white' ? node.wins : node.losses;
  const losses = color === 'white' ? node.losses : node.wins;

  const children: SerializedNode[] = [];
  if (depthRemaining > 0) {
    for (const child of node.children) {
      if (!child.san) continue;
      if (!safeApply(chess, child.san)) continue;
      const childFen = chess.fen();
      children.push(convert(child, color, chess, depthRemaining - 1, childFen));
      chess.undo();
    }
    children.sort((a, b) => b.count - a.count);
  }

  return {
    san: node.san,
    ply: node.ply,
    fen,
    count: node.count,
    wins,
    draws: node.draws,
    losses,
    oppRatingSum: node.avgRating * node.count,
    oppRatingCount: node.count,
    children,
  };
}

function safeApply(chess: Chess, san: string): boolean {
  try {
    return chess.move(san) != null;
  } catch {
    return false;
  }
}

function emptySnapshot(
  color: Color,
  focusPath: string[],
  depth: number,
): SnapshotData {
  return {
    color,
    root: { ...EXPLORER_EMPTY_ROOT },
    totalGames: 0,
    focusPath: [...focusPath],
    depth,
  };
}

export const EXPLORER_EMPTY_ROOT: SerializedNode = {
  san: null,
  ply: 0,
  fen: STARTING_FEN,
  count: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  oppRatingSum: 0,
  oppRatingCount: 0,
  children: [],
};
