/// <reference lib="webworker" />
import { Chess } from 'chess.js';
import type {
  Color,
  Filter,
  Game,
  MsgFromMain,
  MsgFromWorker,
  SerializedNode,
  SnapshotRequest,
  TimeClass,
} from '../types';
import { STARTING_FEN } from '../types';

interface MutNode {
  san: string | null;
  ply: number;
  fen: string;
  count: number;
  wins: number;
  draws: number;
  losses: number;
  oppRatingSum: number;
  oppRatingCount: number;
  children: Map<string, MutNode>;
}

function makeNode(san: string | null, ply: number, fen: string): MutNode {
  return {
    san,
    ply,
    fen,
    count: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    oppRatingSum: 0,
    oppRatingCount: 0,
    children: new Map(),
  };
}

let allGames: Game[] = [];
let needsSort = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshotAt = 0;

let lastFilter: Filter = {
  timeClasses: ['bullet', 'blitz', 'rapid', 'classical'],
  limit: 2000,
};
let lastColor: Color = 'white';
let lastRequest: SnapshotRequest = { focusPath: [], depth: 6 };

function matchesFilter(g: Game, f: Filter): boolean {
  if (!f.timeClasses.includes(g.timeClass as TimeClass)) return false;
  if (f.from !== undefined && g.playedAt < f.from) return false;
  if (f.to !== undefined && g.playedAt > f.to) return false;
  if (f.oppRatingMin !== undefined) {
    if (g.oppRating == null || g.oppRating < f.oppRatingMin) return false;
  }
  if (f.oppRatingMax !== undefined) {
    if (g.oppRating == null || g.oppRating > f.oppRatingMax) return false;
  }
  return true;
}

function selectGames(filter: Filter, color: Color): Game[] {
  if (needsSort) {
    // Newest first, so .slice(0, limit) takes the most recent.
    allGames.sort((a, b) => b.playedAt - a.playedAt);
    needsSort = false;
  }
  const filtered: Game[] = [];
  for (const g of allGames) {
    if (g.userColor !== color) continue;
    if (!matchesFilter(g, filter)) continue;
    filtered.push(g);
    if (filter.limit != null && filtered.length >= filter.limit) break;
  }
  return filtered;
}

interface BuildResult {
  root: MutNode;
  totalGames: number;
}

function buildSubtree(
  games: Game[],
  focusPath: string[],
  depth: number,
): BuildResult {
  // Phase 1: Pure array operations — no chess.js.
  // Walk each game, check if it follows focusPath, then record children.
  const focusLen = focusPath.length;

  // Root node — san/fen filled in later.
  const rootSan = focusPath.length > 0 ? focusPath[focusPath.length - 1] : null;
  const root = makeNode(rootSan, focusLen, STARTING_FEN);
  let totalGames = 0;

  // nodePathToMutNode: maps local SAN path key -> MutNode for fast child lookup.
  // 'root' -> root node; 'e4' -> e4 child; 'e4>e5' -> grandchild, etc.
  const nodeMap = new Map<string, MutNode>();
  nodeMap.set('root', root);

  for (const g of games) {
    // Check focusPath prefix.
    if (g.moves.length < focusLen) continue;
    let follows = true;
    for (let i = 0; i < focusLen; i++) {
      if (g.moves[i] !== focusPath[i]) { follows = false; break; }
    }
    if (!follows) continue;

    totalGames++;
    const win = g.result === 'win';
    const draw = g.result === 'draw';
    const opp = g.oppRating;

    // Increment root.
    root.count++;
    if (win) root.wins++; else if (draw) root.draws++; else root.losses++;
    if (opp != null) { root.oppRatingSum += opp; root.oppRatingCount++; }

    // Walk depth plies after focus.
    const end = Math.min(g.moves.length, focusLen + depth);
    let pathKey = 'root';
    let parent = root;
    for (let i = focusLen; i < end; i++) {
      const san = g.moves[i];
      const childKey = pathKey === 'root' ? san : `${pathKey}>${san}`;
      let child = nodeMap.get(childKey);
      if (!child) {
        // Placeholder FEN — filled in after tree is built.
        child = makeNode(san, i + 1, STARTING_FEN);
        parent.children.set(san, child);
        nodeMap.set(childKey, child);
      }
      child.count++;
      if (win) child.wins++; else if (draw) child.draws++; else child.losses++;
      if (opp != null) { child.oppRatingSum += opp; child.oppRatingCount++; }
      pathKey = childKey;
      parent = child;
    }
  }

  // Phase 2: Fill FENs using chess.js — one traversal over unique paths.
  // Single chess instance, replayed incrementally per path.
  // We do a DFS, keeping a chess instance on a stack.
  function fillFens(node: MutNode, chess: Chess, depth: number): void {
    node.fen = chess.fen();
    if (depth === 0) return;
    for (const [san, child] of node.children) {
      try {
        const mv = chess.move(san);
        if (!mv) continue;
        fillFens(child, chess, depth - 1);
        chess.undo();
      } catch {
        // Skip invalid moves.
      }
    }
  }

  // Set up chess to focus position.
  const focusChess = new Chess();
  let focusOk = true;
  for (const san of focusPath) {
    try {
      if (!focusChess.move(san)) { focusOk = false; break; }
    } catch { focusOk = false; break; }
  }
  if (focusOk) {
    fillFens(root, focusChess, depth);
  }

  return { root, totalGames };
}

function serialise(node: MutNode, minCount: number): SerializedNode {
  const children: SerializedNode[] = [];
  for (const c of node.children.values()) {
    if (c.count >= minCount) children.push(serialise(c, minCount));
  }
  children.sort((a, b) => b.count - a.count);
  return {
    san: node.san,
    ply: node.ply,
    fen: node.fen,
    count: node.count,
    wins: node.wins,
    draws: node.draws,
    losses: node.losses,
    oppRatingSum: node.oppRatingSum,
    oppRatingCount: node.oppRatingCount,
    children,
  };
}

function post(msg: MsgFromWorker) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

const STREAM_THROTTLE_MS = 1000;

let depthTimer: ReturnType<typeof setTimeout> | null = null;

function cancelDepthTimer() {
  if (depthTimer) { clearTimeout(depthTimer); depthTimer = null; }
}

function emitFullDepth(games: Game[], totalGames: number, minCount: number) {
  const { root } = buildSubtree(games, lastRequest.focusPath, lastRequest.depth);
  post({
    type: 'snapshot',
    color: lastColor,
    root: serialise(root, minCount),
    totalGames,
    focusPath: [...lastRequest.focusPath],
    depth: lastRequest.depth,
  });
  lastSnapshotAt = Date.now();
}


function countMatching(games: Game[], focusPath: string[]): number {
  const focusLen = focusPath.length;
  let n = 0;
  for (const g of games) {
    if (g.moves.length < focusLen) continue;
    let ok = true;
    for (let i = 0; i < focusLen; i++) {
      if (g.moves[i] !== focusPath[i]) { ok = false; break; }
    }
    if (ok) n++;
  }
  return n;
}

function emitSnapshot() {
  cancelDepthTimer();
  const games = selectGames(lastFilter, lastColor);
  const totalGames = countMatching(games, lastRequest.focusPath);
  const minCount = totalGames <= 10 ? 1 : Math.max(2, Math.floor(totalGames * 0.001));
  emitFullDepth(games, totalGames, minCount);
}

// Called during streaming — emits a single full-depth snapshot, throttled.
function scheduleStreamSnapshot() {
  if (pendingTimer) return;
  const elapsed = Date.now() - lastSnapshotAt;
  const wait = Math.max(0, STREAM_THROTTLE_MS - elapsed);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    // Only emit if no cascade is running (don't interrupt a zoom cascade).
    if (depthTimer) return;
    const games = selectGames(lastFilter, lastColor);
    const totalGames = countMatching(games, lastRequest.focusPath);
    const minCount = totalGames <= 10 ? 1 : Math.max(2, Math.floor(totalGames * 0.001));
    emitFullDepth(games, totalGames, minCount);
  }, wait);
}

self.addEventListener('message', (ev: MessageEvent<MsgFromMain>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'reset') {
      allGames = [];
      needsSort = false;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      cancelDepthTimer();
      return;
    }
    if (msg.type === 'ingest') {
      for (const g of msg.games) allGames.push(g);
      needsSort = true;
      post({ type: 'progress', ingested: allGames.length });
      if (msg.final) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        cancelDepthTimer();
        emitSnapshot(); // full cascade now that all games are in
      } else {
        scheduleStreamSnapshot(); // throttled full-depth update while streaming
      }
      return;
    }
    if (msg.type === 'snapshot') {
      lastFilter = msg.filter;
      lastColor = msg.color;
      lastRequest = msg.request;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      cancelDepthTimer();
      emitSnapshot();
      return;
    }
    if (msg.type === 'prefetch') {
      // Compute snapshot for a child path without disrupting the current state.
      const games = selectGames(msg.filter, msg.color);
      const fp = msg.request.focusPath;
      const totalGames = countMatching(games, fp);
      const minCount = totalGames <= 10 ? 1 : Math.max(2, Math.floor(totalGames * 0.001));
      const { root } = buildSubtree(games, fp, msg.request.depth);
      post({
        type: 'snapshot',
        color: msg.color,
        root: serialise(root, minCount),
        totalGames,
        focusPath: [...fp],
        depth: msg.request.depth,
        prefetch: true,
      });
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export {};
