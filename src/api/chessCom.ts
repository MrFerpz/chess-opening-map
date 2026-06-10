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
  const CONCURRENCY = 6;

  // Fetch months in parallel batches, preserving newest-first order.
  for (let i = 0; i < reversed.length; i += CONCURRENCY) {
    const batch = reversed.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = (await res.json()) as { games: ChessComGame[] };
        return (data.games ?? []).reverse();
      }),
    );
    for (const games of results) {
      for (const raw of games) {
        const g = normalise(raw, username);
        if (!g) continue;
        if (since && g.playedAt <= since) continue;
        yield g;
      }
    }
  }
}
