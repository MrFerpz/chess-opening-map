// Move sounds. chess.js itself produces no audio — it only gives us the move
// metadata (via SAN) that lets us choose which clip to play. Audio is plain
// HTMLAudioElement playback of files in public/sounds/.
//
// Filenames follow the Lichess "standard" set (CC-licensed). Drop the matching
// .mp3 files into public/sounds/ — see public/sounds/README.md.

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'navigate' | 'end';

const FILES: Record<SoundName, string> = {
  move: '/sounds/move.mp3',
  capture: '/sounds/capture.mp3',
  check: '/sounds/check.mp3',
  castle: '/sounds/castle.mp3',
  promote: '/sounds/promote.mp3',
  navigate: '/sounds/navigate.mp3',
  end: '/sounds/end.mp3',
};

const STORAGE_KEY = 'sound-enabled';

// Default on, but persisted (mirrors the engine-enabled pattern in App.tsx).
let enabled = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored == null ? true : stored === 'true';
  } catch {
    return true;
  }
})();

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore — preference just won't persist
  }
}

// Lazily-created, reused audio elements so we don't allocate per play.
const cache = new Map<SoundName, HTMLAudioElement>();

function get(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let el = cache.get(name);
  if (!el) {
    el = new Audio(FILES[name]);
    el.preload = 'auto';
    cache.set(name, el);
  }
  return el;
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const el = get(name);
  if (!el) return;
  try {
    el.currentTime = 0;
    // play() rejects if the user hasn't interacted yet, or the file is missing.
    void el.play().catch(() => { /* ignore autoplay / missing-file errors */ });
  } catch {
    // ignore
  }
}

// Map a SAN string (e.g. "Nxe5+", "O-O", "e8=Q#") to the right sound. Game-end
// states (checkmate "#") take priority, then promotion, castle, capture, check,
// and finally a plain move.
export function soundForSan(san: string | null | undefined): SoundName {
  if (!san) return 'move';
  if (san.includes('#')) return 'end';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  if (san.includes('+')) return 'check';
  return 'move';
}

// Convenience: play the sound implied by a SAN.
export function playMoveSound(san: string | null | undefined): void {
  playSound(soundForSan(san));
}
