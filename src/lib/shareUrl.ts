import type { Color, Filter, Platform } from '../types';

interface ShareState {
  platform: Platform;
  username: string;
  color: Color;
  filter: Filter;
  focusPath: string[];
}

export function encodeShareUrl(state: ShareState): string {
  const compact = {
    p: state.platform === 'lichess' ? 'l' : 'c',
    u: state.username,
    col: state.color === 'white' ? 'w' : 'b',
    tc: state.filter.timeClasses,
    lim: state.filter.limit,
    ...(state.filter.from !== undefined && { from: state.filter.from }),
    ...(state.filter.to !== undefined && { to: state.filter.to }),
    ...(state.filter.oppRatingMin !== undefined && { rMin: state.filter.oppRatingMin }),
    ...(state.filter.oppRatingMax !== undefined && { rMax: state.filter.oppRatingMax }),
    ...(state.focusPath.length > 0 && { fp: state.focusPath }),
  };
  const hash = btoa(JSON.stringify(compact));
  return `${window.location.origin}${window.location.pathname}#${hash}`;
}

export function decodeShareUrl(): ShareState | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const raw = JSON.parse(atob(hash));
    if (!raw.u || !raw.p) return null;
    return {
      platform: raw.p === 'l' ? 'lichess' : 'chesscom',
      username: String(raw.u),
      color: raw.col === 'b' ? 'black' : 'white',
      filter: {
        timeClasses: Array.isArray(raw.tc) ? raw.tc : ['bullet', 'blitz', 'rapid', 'classical'],
        limit: raw.lim ?? 2000,
        ...(raw.from !== undefined && { from: raw.from }),
        ...(raw.to !== undefined && { to: raw.to }),
        ...(raw.rMin !== undefined && { oppRatingMin: raw.rMin }),
        ...(raw.rMax !== undefined && { oppRatingMax: raw.rMax }),
      },
      focusPath: Array.isArray(raw.fp) ? raw.fp : [],
    };
  } catch {
    return null;
  }
}
