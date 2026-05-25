import { hcl } from 'd3-color';
import type { SerializedNode } from '../types';

// Hue (HCL) per first-ply family. Reference image: e4 ≈ blue, d4 ≈ orange.
const FAMILY_HUE: Record<string, number> = {
  e4: 240, // blue
  d4: 50, // orange
  c4: 140, // green
  Nf3: 10, // red
  Nc3: 290, // purple
  b3: 200, // teal
  g3: 170, // sea green
  f4: 320, // magenta
};
// A deterministic fallback palette for unrecognised first plies.
const FALLBACK_HUES = [60, 100, 180, 260, 340];

export function hueFor(firstPly: string | null | undefined): number {
  if (!firstPly) return 220;
  if (firstPly in FAMILY_HUE) return FAMILY_HUE[firstPly];
  // Hash the SAN string to a stable fallback hue.
  let h = 0;
  for (let i = 0; i < firstPly.length; i++) h = (h * 31 + firstPly.charCodeAt(i)) | 0;
  return FALLBACK_HUES[Math.abs(h) % FALLBACK_HUES.length];
}

export function winRate(n: { wins: number; draws: number; losses: number }): number {
  const total = n.wins + n.draws + n.losses;
  if (total === 0) return 0.5;
  return (n.wins + 0.5 * n.draws) / total;
}

export function avgOppRating(n: SerializedNode): number | null {
  if (n.oppRatingCount === 0) return null;
  return Math.round(n.oppRatingSum / n.oppRatingCount);
}

// Maps win rate [0..1] to a red → muted gold → green HCL gradient.
// ±15pp from 50% saturates the scale so realistic spreads (e.g. 45–65%) read clearly.
export function colorForWinRate(rate: number, depthFromFocus: number): string {
  const clamped = Math.max(0, Math.min(1, rate));
  // Clamp deviation to ±0.15 (15pp) then normalise to [-1, 1].
  const SCALE = 0.06;
  const t = Math.max(-1, Math.min(1, (clamped - 0.5) / SCALE));
  // Hue: green (140°) winning, red (20°) losing.
  const hue = t >= 0 ? 140 : 20;
  // Chroma of 0 at neutral gives true grey; ramps up quickly with deviation.
  const chroma = Math.abs(t) * (40 + Math.min(depthFromFocus, 5) * 3);
  const lightness = 50 + Math.abs(t) * 12;
  return hcl(hue, chroma, lightness).formatHex();
}

// Colour for a node based on the **local** path under the focus root.
// localPath[0] = the first ply of the visible subtree → defines the hue family.
// Lightness alternates by global ply: lighter = white's move, darker = black's move.
export function colorForLocalPath(
  localPath: string[],
  depthFromFocus: number,
  siblingIndex: number,
  focusPathLength = 0,
): string {
  const first = localPath.length > 0 ? localPath[0] : null;
  const hue = hueFor(first);
  const chroma = 40 + Math.min(depthFromFocus, 6) * 4; // 40..64
  const baseL = 56;
  const globalPly = focusPathLength + depthFromFocus;
  // odd global ply = white's move → lighter; even = black's move → darker
  const isWhiteMove = globalPly % 2 === 1;
  const lightness = baseL + (isWhiteMove ? 8 : -6) + (siblingIndex % 2 === 0 ? 0 : -3);
  return hcl(hue, chroma, lightness).formatHex();
}
