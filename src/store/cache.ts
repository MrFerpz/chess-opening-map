import { getDb, makeCacheKey } from './db';
import type { CachedGameRow, Game, Platform, SyncMeta } from '../types';

export async function putGames(
  platform: Platform,
  username: string,
  games: Game[],
): Promise<void> {
  if (games.length === 0) return;
  const db = await getDb();
  const cacheKey = makeCacheKey(platform, username);
  const syncedAt = Date.now();
  const tx = db.transaction('games', 'readwrite');
  await Promise.all(
    games.map((g) =>
      tx.store.put({ ...g, cacheKey, syncedAt } satisfies CachedGameRow),
    ),
  );
  await tx.done;
}

export async function listGames(
  platform: Platform,
  username: string,
): Promise<CachedGameRow[]> {
  const db = await getDb();
  const cacheKey = makeCacheKey(platform, username);
  return db.getAllFromIndex('games', 'by-cacheKey', cacheKey);
}

export async function getSyncMeta(
  platform: Platform,
  username: string,
): Promise<SyncMeta | undefined> {
  const db = await getDb();
  return db.get('syncMeta', makeCacheKey(platform, username));
}

export async function setSyncMeta(
  platform: Platform,
  username: string,
  lastPlayedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.put('syncMeta', {
    key: makeCacheKey(platform, username),
    lastPlayedAt,
    lastSyncedAt: Date.now(),
  });
}

export async function clearUser(
  platform: Platform,
  username: string,
): Promise<void> {
  const db = await getDb();
  const cacheKey = makeCacheKey(platform, username);
  const tx = db.transaction(['games', 'syncMeta'], 'readwrite');
  const idx = tx.objectStore('games').index('by-cacheKey');
  let cursor = await idx.openCursor(cacheKey);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('syncMeta').delete(cacheKey);
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['games', 'syncMeta'], 'readwrite');
  await tx.objectStore('games').clear();
  await tx.objectStore('syncMeta').clear();
  await tx.done;
}

export async function cachedUserCount(): Promise<number> {
  const db = await getDb();
  return db.count('syncMeta');
}

export async function findGameByMoves(
  platform: Platform,
  username: string,
  movePrefix: string[],
): Promise<CachedGameRow | undefined> {
  const db = await getDb();
  const cacheKey = makeCacheKey(platform, username);
  const all = await db.getAllFromIndex('games', 'by-cacheKey', cacheKey);
  return all.find((g) =>
    movePrefix.every((san, i) => g.moves[i] === san),
  );
}
