import type { Game, Platform } from '../types';
import { fetchChessCom } from './chessCom';
import { fetchLichess } from './lichess';

export function fetchGames(
  platform: Platform,
  username: string,
  since?: number,
): AsyncIterable<Game> {
  if (platform === 'chesscom') return fetchChessCom(username, since);
  return fetchLichess(username, since);
}
