import { Chess } from 'chess.js';

export function pgnToMoves(pgn: string): string[] {
  if (!pgn) return [];
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    return [];
  }
  return chess.history();
}
