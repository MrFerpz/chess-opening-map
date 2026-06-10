import type { Game, Result, TimeClass } from '../types';
import { pgnToMoves } from '../parsing/pgnToMoves';

interface LichessPlayer {
  user?: { name?: string; id?: string };
  rating?: number;
  aiLevel?: number;
}

interface LichessGame {
  id: string;
  createdAt: number;
  speed?: string;
  perf?: string;
  status?: string;
  winner?: 'white' | 'black';
  pgn?: string;
  moves?: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  variant?: string;
}

function mapSpeed(s: string | undefined): TimeClass {
  switch (s) {
    case 'bullet':
    case 'ultraBullet':
      return 'bullet';
    case 'blitz':
      return 'blitz';
    case 'rapid':
      return 'rapid';
    case 'classical':
    case 'correspondence':
      return 'classical';
    default:
      return 'blitz';
  }
}

function normalise(raw: LichessGame, username: string): Game | null {
  if (raw.variant && raw.variant !== 'standard') return null;
  const userLower = username.toLowerCase();
  const whiteName = raw.players.white.user?.name?.toLowerCase() ?? '';
  const blackName = raw.players.black.user?.name?.toLowerCase() ?? '';
  let userColor: 'white' | 'black';
  let me: LichessPlayer;
  let opp: LichessPlayer;
  if (whiteName === userLower) {
    userColor = 'white';
    me = raw.players.white;
    opp = raw.players.black;
  } else if (blackName === userLower) {
    userColor = 'black';
    me = raw.players.black;
    opp = raw.players.white;
  } else {
    return null;
  }
  let result: Result;
  if (!raw.winner) result = 'draw';
  else if (raw.winner === userColor) result = 'win';
  else result = 'loss';

  let moves: string[] = [];
  if (raw.moves) {
    moves = raw.moves.split(/\s+/).filter(Boolean);
  } else if (raw.pgn) {
    moves = pgnToMoves(raw.pgn);
  }
  if (moves.length === 0) return null;

  return {
    id: `lichess:${raw.id}`,
    platform: 'lichess',
    username: userLower,
    playedAt: raw.createdAt,
    timeClass: mapSpeed(raw.speed ?? raw.perf),
    userColor,
    result,
    userRating: me.rating ?? null,
    oppRating: opp.rating ?? null,
    oppName: opp.user?.name ?? null,
    moves,
  };
}

export async function checkLichessUser(username: string): Promise<boolean> {
  const res = await fetch(
    `https://lichess.org/api/user/${encodeURIComponent(username)}`,
    { headers: { Accept: 'application/json' } },
  );
  return res.ok;
}

export async function* fetchLichess(
  username: string,
  since?: number,
): AsyncIterable<Game> {
  const params = new URLSearchParams({
    moves: 'true',
    pgnInJson: 'false',
    tags: 'false',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
  });
  if (since) params.set('since', String(since));
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`,
    { headers: { Accept: 'application/x-ndjson' } },
  );
  if (!res.ok) throw new Error(`lichess ${res.status}`);
  if (!res.body) throw new Error('lichess: no response body');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let raw: LichessGame;
        try {
          raw = JSON.parse(line) as LichessGame;
        } catch {
          continue;
        }
        const g = normalise(raw, username);
        if (g) yield g;
      }
    }
    const tail = buf.trim();
    if (tail) {
      try {
        const raw = JSON.parse(tail) as LichessGame;
        const g = normalise(raw, username);
        if (g) yield g;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}
