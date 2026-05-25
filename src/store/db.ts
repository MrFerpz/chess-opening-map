import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CachedGameRow, SyncMeta } from '../types';

interface ChessVisDB extends DBSchema {
  games: {
    key: string;
    value: CachedGameRow;
    indexes: {
      'by-cacheKey': string;
      'by-cacheKey-playedAt': [string, number];
    };
  };
  syncMeta: {
    key: string;
    value: SyncMeta;
  };
}

const DB_NAME = 'chess-visualiser';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ChessVisDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ChessVisDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChessVisDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const games = db.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('by-cacheKey', 'cacheKey');
        games.createIndex('by-cacheKey-playedAt', ['cacheKey', 'playedAt']);
        db.createObjectStore('syncMeta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

export function makeCacheKey(platform: string, username: string): string {
  return `${platform}:${username.toLowerCase()}`;
}
