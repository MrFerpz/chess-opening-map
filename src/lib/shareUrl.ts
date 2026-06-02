import type { Color, Filter, Platform, RatingBand, TimeClass } from '../types';
import { RATING_BANDS, SPEED_PRESETS, DEFAULT_SPEED_PRESET } from '../types';

interface UserShareState {
  mode: 'user';
  platform: Platform;
  username: string;
  color: Color;
  filter: Filter;
  focusPath: string[];
}

interface ExplorerShareState {
  mode: 'explorer';
  band: RatingBand;
  speeds: TimeClass[];
  color: Color;
  focusPath: string[];
}

export type ShareState = UserShareState | ExplorerShareState;

export function encodeShareUrl(state: ShareState): string {
  let compact: Record<string, unknown>;
  if (state.mode === 'explorer') {
    compact = {
      m: 'e',
      band: state.band.min,
      sp: state.speeds,
      col: state.color === 'white' ? 'w' : 'b',
      ...(state.focusPath.length > 0 && { fp: state.focusPath }),
    };
  } else {
    compact = {
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
  }
  const hash = btoa(JSON.stringify(compact));
  return `${window.location.origin}${window.location.pathname}#${hash}`;
}

export function decodeShareUrl(): ShareState | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const raw = JSON.parse(atob(hash));
    if (raw.m === 'e') {
      const band = RATING_BANDS.find((b) => b.min === raw.band) ?? RATING_BANDS[3];
      // Speeds must resolve to a preset we have a data file for (single-speed).
      // Legacy links may carry the old combined ['blitz','rapid'] — match by the
      // first speed, falling back to the default preset.
      const wanted = Array.isArray(raw.sp) ? raw.sp : [];
      const preset =
        SPEED_PRESETS.find((p) => wanted.length === p.speeds.length && p.speeds.every((s) => wanted.includes(s))) ??
        SPEED_PRESETS.find((p) => p.speeds.some((s) => wanted.includes(s))) ??
        DEFAULT_SPEED_PRESET;
      return {
        mode: 'explorer',
        band,
        speeds: preset.speeds,
        color: raw.col === 'b' ? 'black' : 'white',
        focusPath: Array.isArray(raw.fp) ? raw.fp : [],
      };
    }
    if (!raw.u || !raw.p) return null;
    return {
      mode: 'user',
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
