import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc as d3arc } from 'd3-shape';
import type { SerializedNode } from '../types';

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type SunburstNode = HierarchyRectangularNode<SerializedNode>;

export const FULL_CIRCLE = 2 * Math.PI;
// Number of visible move rings outward from the focus root.
export const VISIBLE_RINGS = 6;
// Centre hole reserved for the chess board, in *ringRadius* units.
// Total radius is divided into HOLE_UNITS + VISIBLE_RINGS units.
// 5.0 gives a board ~45% of the chart radius while still leaving 6
// distinguishable move rings around it.
export const HOLE_UNITS = 5.0;

export function buildHierarchy(rootData: SerializedNode): SunburstNode {
  const h = hierarchy<SerializedNode>(rootData, (d) => d.children)
    .sum((d) => (d.children && d.children.length > 0 ? 0 : d.count))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // partition gives each node {x0,x1,y0,y1}. y is depth in plies.
  const layout = partition<SerializedNode>().size([FULL_CIRCLE, h.height + 1]);
  return layout(h);
}

// Rings indexed in "y units" within the partition. The centre hole occupies
// y-units [0, HOLE_UNITS]; move ring k occupies [HOLE_UNITS + (k-1), HOLE_UNITS + k].
// depth 0 = focus root, collapsed in the hole.
// depth k (1..VISIBLE_RINGS) = ring k.
// depth > VISIBLE_RINGS = collapsed at outer edge (invisible).
export function targetFor(node: SunburstNode, visibleRings = VISIBLE_RINGS, holeUnits = HOLE_UNITS): Rect {
  if (node.depth === 0) {
    return { x0: 0, x1: FULL_CIRCLE, y0: 0, y1: 0 };
  }
  if (node.depth > visibleRings) {
    const outer = holeUnits + visibleRings;
    return { x0: node.x0, x1: node.x1, y0: outer, y1: outer };
  }
  return {
    x0: node.x0,
    x1: node.x1,
    y0: holeUnits + (node.depth - 1),
    y1: holeUnits + node.depth,
  };
}

// "Collapsed at centre" target for first-render entry animation.
export function collapsedAtCentre(node: SunburstNode, holeUnits = HOLE_UNITS): Rect {
  return { x0: node.x0, x1: node.x1, y0: holeUnits, y1: holeUnits };
}

export function makeArc(ringRadius: number) {
  return d3arc<Rect>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
    .padRadius(ringRadius * 1.5)
    .innerRadius((d) => d.y0 * ringRadius)
    .outerRadius((d) => Math.max(d.y0 * ringRadius, d.y1 * ringRadius - 1));
}

export function rectVisible(r: Rect): boolean {
  return r.y1 - r.y0 > 0.001 && r.x1 - r.x0 > 0.001;
}

export function labelVisible(r: Rect): boolean {
  return (r.y1 - r.y0) > 0.4 && (r.y1 - r.y0) * (r.x1 - r.x0) > 0.04;
}

export function labelTransform(r: Rect, ringRadius: number): string {
  const angle = (((r.x0 + r.x1) / 2) * 180) / Math.PI;
  const rad = ((r.y0 + r.y1) / 2) * ringRadius;
  return `rotate(${angle - 90}) translate(${rad},0) rotate(${angle < 180 ? 0 : 180})`;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x0: a.x0 + (b.x0 - a.x0) * t,
    x1: a.x1 + (b.x1 - a.x1) * t,
    y0: a.y0 + (b.y0 - a.y0) * t,
    y1: a.y1 + (b.y1 - a.y1) * t,
  };
}

// Cubic ease in-out
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Path key by ancestor SANs (stable across snapshots).
export function pathKey(node: SunburstNode): string {
  const arr: string[] = [];
  let cur: SunburstNode | null = node;
  while (cur && cur.depth > 0) {
    arr.unshift(cur.data.san ?? '?');
    cur = cur.parent;
  }
  return arr.join('>') || 'root';
}

// Local SAN path of a node (relative to subtree root). Used to extend focusPath.
export function localPath(node: SunburstNode): string[] {
  const arr: string[] = [];
  let cur: SunburstNode | null = node;
  while (cur && cur.depth > 0) {
    if (cur.data.san) arr.unshift(cur.data.san);
    cur = cur.parent;
  }
  return arr;
}
