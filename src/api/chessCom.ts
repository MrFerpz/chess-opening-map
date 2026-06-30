import type { Game, Result, TimeClass } from '../types';
import { pgnToMoves } from '../parsing/pgnToMoves';

interface ChessComPlayer {
  username: string;
  rating?: number;
  result?: string;
}

interface ChessComGame {
  url: string;
  pgn: string;
  time_class?: string;
  end_time?: number;
  eco?: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
  uuid?: string;
  rules?: string;
}

const RESULT_MAP_WIN = new Set(['win']);
const RESULT_MAP_DRAW = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function mapResult(userResult: string | undefined): Result {
  if (!userResult) return 'loss';
  if (RESULT_MAP_WIN.has(userResult)) return 'win';
  if (RESULT_MAP_DRAW.has(userResult)) return 'draw';
  return 'loss';
}

function mapTimeClass(tc: string | undefined): TimeClass {
  switch (tc) {
    case 'bullet':
      return 'bullet';
    case 'blitz':
      return 'blitz';
    case 'rapid':
      return 'rapid';
    case 'daily':
    case 'classical':
      return 'classical';
    default:
      return 'blitz';
  }
}

function normalise(raw: ChessComGame, username: string): Game | null {
  if (raw.rules && raw.rules !== 'chess') return null;
  if (!raw.pgn) return null;
  const userLower = username.toLowerCase();
  const whiteLower = raw.white.username.toLowerCase();
  const blackLower = raw.black.username.toLowerCase();
  let userColor: 'white' | 'black';
  let me: ChessComPlayer;
  let opp: ChessComPlayer;
  if (whiteLower === userLower) {
    userColor = 'white';
    me = raw.white;
    opp = raw.black;
  } else if (blackLower === userLower) {
    userColor = 'black';
    me = raw.black;
    opp = raw.white;
  } else {
    return null;
  }
  const moves = pgnToMoves(raw.pgn);
  if (moves.length === 0) return null;
  return {
    id: `chesscom:${raw.uuid ?? raw.url}`,
    platform: 'chesscom',
    username: userLower,
    playedAt: (raw.end_time ?? 0) * 1000,
    timeClass: mapTimeClass(raw.time_class),
    userColor,
    result: mapResult(me.result),
    userRating: me.rating ?? null,
    oppRating: opp.rating ?? null,
    oppName: opp.username ?? null,
    eco: raw.eco,
    moves,
  };
}

export async function checkChessComUser(username: string): Promise<boolean> {
  const res = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}`,
    { method: 'HEAD' },
  );
  return res.ok;
}

export async function* fetchChessCom(
  username: string,
  since?: number,
): AsyncIterable<Game> {
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
  );
  if (!archivesRes.ok) {
    throw new Error(`chess.com archives ${archivesRes.status}`);
  }
  const { archives } = (await archivesRes.json()) as { archives: string[] };
  // archives are urls like .../games/YYYY/MM, oldest first.
  const sinceDate = since ? new Date(since) : null;
  const filtered = sinceDate
    ? archives.filter((u) => {
        const m = u.match(/(\d{4})\/(\d{2})$/);
        if (!m) return true;
        const year = Number(m[1]);
        const month = Number(m[2]);
        // include the month containing `since` and everything after
        const monthStart = new Date(Date.UTC(year, month, 1));
        return monthStart.getTime() >= sinceDate.getTime() - 32 * 24 * 3600 * 1000;
      })
    : archives;

  const reversed = filtered.reverse();
  const CONCURRENCY = 8;

  async function fetchMonth(url: string): Promise<ChessComGame[]> {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { games: ChessComGame[] };
    return (data.games ?? []).reverse();
  }

  // Continuous pool: keep CONCURRENCY months in flight at all times, but yield
  // them strictly newest-first so the sunburst fills in chronological order.
  // A new month starts the instant any lane frees up, instead of waiting for a
  // whole batch's slowest request (which the old Promise.all batching did).
  let next = 0;
  const inFlight = new Map<number, Promise<{ index: number; games: ChessComGame[] }>>();

  const launch = () => {
    while (inFlight.size < CONCURRENCY && next < reversed.length) {
      const index = next++;
      inFlight.set(
        index,
        fetchMonth(reversed[index]).then((games) => ({ index, games })),
      );
    }
  };

  launch();
  let wantIndex = 0;
  // Buffer results that arrive out of order until their turn comes.
  const ready = new Map<number, ChessComGame[]>();

  while (inFlight.size > 0 || ready.has(wantIndex)) {
    if (!ready.has(wantIndex)) {
      const { index, games } = await Promise.race(inFlight.values());
      inFlight.delete(index);
      ready.set(index, games);
      launch();
    }
    while (ready.has(wantIndex)) {
      const games = ready.get(wantIndex)!;
      ready.delete(wantIndex);
      wantIndex++;
      for (const raw of games) {
        const g = normalise(raw, username);
        if (!g) continue;
        if (since && g.playedAt <= since) continue;
        yield g;
      }
    }
  }
}
