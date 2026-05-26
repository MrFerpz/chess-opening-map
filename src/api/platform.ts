import type { Game, Platform } from '../types';
import { fetchChessCom, checkChessComUser } from './chessCom';
import { fetchLichess, checkLichessUser } from './lichess';

export function checkUserExists(platform: Platform, username: string): Promise<boolean> {
  if (platform === 'chesscom') return checkChessComUser(username);
  return checkLichessUser(username);
}

export function fetchGames(
  platform: Platform,
  username: string,
  since?: number,
): AsyncIterable<Game> {
  if (platform === 'chesscom') return fetchChessCom(username, since);
  return fetchLichess(username, since);
}
