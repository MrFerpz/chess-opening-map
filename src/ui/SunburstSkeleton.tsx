import { useMemo } from 'react';
import { arc as d3arc } from 'd3-shape';
import { HOLE_UNITS, VISIBLE_RINGS } from '../vis/sunburstLayout';

interface Segment { x0: number; x1: number; y0: number; y1: number; }

const TAU = 2 * Math.PI;

// Deterministic seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Build a tree of angular spans, splitting each parent among children.
function buildRings(rings: number, seed: number): Segment[] {
  const rand = mulberry32(seed);
  const segments: Segment[] = [];

  // Ring 1: split full circle into 3–5 slices
  const ring1Count = 4;
  const ring1Spans: [number, number][] = [];
  const weights1 = Array.from({ length: ring1Count }, () => 0.5 + rand());
  const total1 = weights1.reduce((a, b) => a + b, 0);
  let cursor = 0;
  for (let i = 0; i < ring1Count; i++) {
    const span = (weights1[i] / total1) * TAU;
    ring1Spans.push([cursor, cursor + span]);
    segments.push({ x0: cursor, x1: cursor + span, y0: HOLE_UNITS, y1: HOLE_UNITS + 1 });
    cursor += span;
  }

  // Rings 2–N: split each parent span into 1–3 children, dropping small ones
  let parentSpans = ring1Spans;
  for (let ring = 2; ring <= rings; ring++) {
    const nextSpans: [number, number][] = [];
    for (const [px0, px1] of parentSpans) {
      const parentSize = px1 - px0;
      if (parentSize < 0.08) continue; // skip tiny slivers
      const childCount = parentSize > 1.2 ? 3 : parentSize > 0.5 ? 2 : 1;
      if (childCount === 1) {
        // shrink slightly for visual interest
        const shrink = 0.05 + rand() * 0.1;
        const x0 = px0 + parentSize * shrink * 0.5;
        const x1 = px1 - parentSize * shrink * 0.5;
        segments.push({ x0, x1, y0: HOLE_UNITS + ring - 1, y1: HOLE_UNITS + ring });
        nextSpans.push([x0, x1]);
      } else {
        const ws = Array.from({ length: childCount }, () => 0.4 + rand() * 0.6);
        const wt = ws.reduce((a, b) => a + b, 0);
        let c = px0 + parentSize * 0.02; // small gap at edges
        for (let j = 0; j < childCount; j++) {
          const w = (ws[j] / wt) * parentSize * 0.96;
          if (w > 0.05) {
            segments.push({ x0: c, x1: c + w, y0: HOLE_UNITS + ring - 1, y1: HOLE_UNITS + ring });
            nextSpans.push([c, c + w]);
          }
          c += w + parentSize * 0.02 / childCount;
        }
      }
    }
    parentSpans = nextSpans;
  }

  return segments;
}

interface Props {
  size?: number;
}

export function SunburstSkeleton({ size = 480 }: Props) {
  const radius = size / 2;
  const ringRadius = radius / (HOLE_UNITS + VISIBLE_RINGS);
  const holeRadius = ringRadius * HOLE_UNITS;

  const arcGen = useMemo(() =>
    d3arc<Segment>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle(0.008)
      .padRadius(ringRadius * 1.5)
      .innerRadius((d) => d.y0 * ringRadius)
      .outerRadius((d) => d.y1 * ringRadius - 1),
    [ringRadius],
  );

  const segments = useMemo(() => buildRings(VISIBLE_RINGS, 42), []);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-radius} ${-radius} ${size} ${size}`}
      style={{ display: 'block', pointerEvents: 'none' }}
      aria-hidden
    >
      {/* Outer disc */}
      <circle r={radius} fill="rgba(255,255,255,0.015)" />
      <circle r={radius - 1} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

      {/* Skeleton segments — faint, no colour */}
      {segments.map((seg, i) => {
        const depth = Math.round(seg.y0 - HOLE_UNITS + 1);
        const opacity = 0.12 - depth * 0.012; // fade outer rings more
        return (
          <path
            key={i}
            d={arcGen(seg) ?? ''}
            fill={`rgba(255,255,255,${opacity})`}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        );
      })}

      {/* Centre hole */}
      <circle r={holeRadius} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
    </svg>
  );
}
