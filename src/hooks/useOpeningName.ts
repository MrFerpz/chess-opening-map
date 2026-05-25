import { useMemo } from 'react';
import openingsRaw from '../data/openings.json';

interface OpeningEntry { eco: string; name: string; }
const openings = openingsRaw as Record<string, OpeningEntry>;

/**
 * Given the list of moves played so far (as SAN strings), returns the
 * deepest matching opening name. Walks backwards from the full sequence
 * until a match is found, so partial prefixes always resolve.
 */
export function useOpeningName(moves: string[]): OpeningEntry | null {
  return useMemo(() => {
    for (let len = moves.length; len > 0; len--) {
      const key = moves.slice(0, len).join(' ');
      if (openings[key]) return openings[key];
    }
    return null;
  }, [moves.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
}
