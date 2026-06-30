import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Color, SerializedNode } from '../types';
import { STARTING_FEN } from '../types';
import {
  buildHierarchy,
  easeInOut,
  HOLE_UNITS,
  lerpRect,
  localPath,
  pathKey,
  rectVisible,
  targetFor,
  VISIBLE_RINGS,
  type Rect,
  type SunburstNode,
} from './sunburstLayout';
import { colorForLocalPath, colorForWinRate, winRate } from './colorScale';
import { CenterBoard } from './CenterBoard';
import { Tooltip } from './Tooltip';
import { EvalBar } from './EvalBar';
import { formatEval } from '../hooks/useStockfish';
import { useStockfish } from '../hooks/useStockfish';
import { drawBoardOnCanvas } from './boardToCanvas';
import { playMoveSound, playSound } from '../lib/sounds';
import { ArrowLeft, ArrowLeftFromLine, Palette, Volume2, VolumeX } from 'lucide-react';

export interface SunburstHandle {
  exportPng: (filename?: string) => Promise<void>;
}

export interface TopLine {
  san: string | null;
  count: number;
  wins: number;
  draws: number;
  losses: number;
}

export type ColorMode = 'opening' | 'winrate';

interface Props {
  root: SerializedNode;
  totalGames: number;
  color: Color;
  colorMode?: ColorMode;
  onColorModeChange?: (mode: ColorMode) => void;
  focusPath: string[];
  onFocusChange: (newPath: string[]) => void;
  size?: number;
  exportRef?: React.Ref<SunburstHandle>;
  isMobile?: boolean;
  isNarrow?: boolean;
  visibleRings?: number;
  holeUnits?: number;
  // When true, render one extra "ghost" ring beyond visibleRings, faded outward.
  ghostRing?: boolean;
  openingName?: string | null;
  onTopLinesChange?: (lines: TopLine[]) => void;
  engineEnabled?: boolean;
  soundOn?: boolean;
  onSoundToggle?: (on: boolean) => void;
}

const ANIM_MS = 350;
const MOBILE_ZOOM_DELAY_MS = 140;
// Width (in ring units) of the faded ghost ring beyond the solid rings.
const GHOST_UNITS = 0.7;

// Canvas backing resolution. Phones often report DPR 2.6–3, which makes every
// repaint push 2–3× the pixels of DPR 2 for no visible gain at this size —
// cap it on touch devices so repaints don't compete with piece animations.
const CANVAS_DPR = typeof window === 'undefined'
  ? 1
  : window.matchMedia?.('(pointer: coarse)').matches
    ? Math.min(window.devicePixelRatio || 1, 2)
    : window.devicePixelRatio || 1;

const touchSurfaceStyle: React.CSSProperties = {
  WebkitTapHighlightColor: 'transparent',
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  touchAction: 'manipulation',
  outline: 'none',
};

// Per-arc animation state — start rect, current target, animation start time + delay.
interface ArcAnim {
  start: Rect;
  target: Rect;
  startedAt: number; // performance.now() when this arc's animation began
}

export function Sunburst({
  root: rootData,
  totalGames,
  color,
  colorMode = 'opening',
  onColorModeChange,
  focusPath,
  onFocusChange,
  size = 720,
  exportRef,
  isMobile,
  isNarrow,
  visibleRings: visibleRingsProp,
  holeUnits: holeUnitsProp,
  ghostRing = false,
  openingName,
  onTopLinesChange,
  engineEnabled = true,
  soundOn = true,
  onSoundToggle,
}: Props) {
  const visibleRings = visibleRingsProp ?? VISIBLE_RINGS;
  const holeUnits = holeUnitsProp ?? HOLE_UNITS;
  const [hover, setHover] = useState<{
    node: SerializedNode;
    x: number;
    y: number;
  } | null>(null);
  const [mobileInfo, setMobileInfo] = useState<SerializedNode | null>(null);
  const stockfish = useStockfish(engineEnabled);
  const evalCache = {
    onHover: (fen: string) => { void stockfish.enqueue(fen); },
    onLeave: () => {},
    // null (not undefined) when the engine is off so UI shows '-' rather than
    // a perpetual '…' spinner.
    getEval: (fen: string) => engineEnabled ? stockfish.getPositionEval(fen)?.eval : null,
  };

  // Remember the last child entered at each depth so → can re-enter it.
  const forwardHistoryRef = useRef<string[]>([]);

  // Fetch eval for the current focus position.
  useEffect(() => {
    const fen = rootData.fen || STARTING_FEN;
    void stockfish.enqueue(fen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData.fen]);

  useEffect(() => () => {
    if (mobileZoomTimeoutRef.current != null) window.clearTimeout(mobileZoomTimeoutRef.current);
  }, []);

  // A ghost ring (if enabled) gets a thin band beyond the solid rings; reserving
  // it in the unit budget shrinks the solid rings only slightly.
  const ghostUnits = ghostRing ? GHOST_UNITS : 0;
  const radius = size / 2;
  const ringRadius = radius / (holeUnits + visibleRings + ghostUnits);
  const holeRadius = ringRadius * holeUnits;
  const boardSize = Math.floor(holeRadius * Math.SQRT2);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Max depth we actually render (ghost ring adds one beyond the solid rings).
  const maxDepth = visibleRings + (ghostRing ? 1 : 0);
  // Target rect for an arc, accounting for the ghost ring's thinner band.
  const targetForArc = (n: SunburstNode): Rect => {
    if (ghostRing && n.depth === visibleRings + 1) {
      return { x0: n.x0, x1: n.x1, y0: holeUnits + visibleRings, y1: holeUnits + visibleRings + GHOST_UNITS };
    }
    return targetFor(n, visibleRings, holeUnits);
  };

  const hierarchyRoot = useMemo(() => buildHierarchy(rootData), [rootData]);
  const nodes = useMemo(
    () => hierarchyRoot.descendants() as SunburstNode[],
    [hierarchyRoot],
  );

  // Per-pathKey animation state (source of truth for the rAF loop).
  const animMap = useRef<Map<string, ArcAnim>>(new Map());
  // Current interpolated rect — what was last painted.
  const renderedRectsRef = useRef<Map<string, Rect>>(new Map());

  // Fill colours kept in sync with the current focusPath so the rAF loop
  // can stamp the correct colour at the same moment it makes an arc visible.
  const fillMapRef = useRef<Map<string, string>>(new Map());
  // Node data needed by the canvas painter (san label, depth).
  const nodeDataRef = useRef<Map<string, { san: string | null; depth: number }>>(new Map());

  const rafRef = useRef<number | null>(null);
  const prevFocusPathRef = useRef<string[]>(focusPath);
  const justZoomedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusFenRef = useRef<string>(STARTING_FEN);
  const colorRef = useRef<Color>(color);
  colorRef.current = color;
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  const highlightedArcKeyRef = useRef<string | null>(null);
  const mobileZoomTimeoutRef = useRef<number | null>(null);
  const activeMobilePointerRef = useRef<{ pointerId: number; key: string } | null>(null);
  const clickHandledByPointerRef = useRef(false);
  // Set to true when focusPath changes; cleared after the next hover re-detection.
  const pendingHoverUpdate = useRef(false);

  useImperativeHandle(exportRef, () => ({
    exportPng: async (filename = 'chess-openings.png') => {
      const sunburstCanvas = canvasRef.current;
      if (!sunburstCanvas) return;

      const dpr = CANVAS_DPR;

      const canvas = document.createElement('canvas');
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.drawImage(
        sunburstCanvas,
        0,
        0,
        sunburstCanvas.width,
        sunburstCanvas.height,
        0,
        0,
        size,
        size,
      );

      // Draw the board programmatically so we bypass DOM serialization
      //    issues (react-chessboard renders HTML divs, not a single SVG).
      const bx = (size - boardSize) / 2;
      const by = (size - boardSize) / 2;
      await drawBoardOnCanvas(ctx, focusFenRef.current, colorRef.current, boardSize, bx, by);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    },
  }), [size, boardSize]);

  // ─── Canvas painter ───────────────────────────────────────────────────────
  // Draws all arcs + labels onto the canvas in one pass. Called from the rAF loop.
  function paintCanvas(rendered: Map<string, Rect>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = CANVAS_DPR;
    const cx = (size / 2) * dpr;
    const cy = (size / 2) * dpr;
    const rr = ringRadius * dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background disc
    ctx.beginPath();
    ctx.arc(cx, cy, radius * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = '#13161f';
    ctx.fill();

    // Arcs
    for (const [key, r] of rendered) {
      if (!rectVisible(r)) continue;
      const innerR = r.y0 * rr;
      const outerR = Math.max(r.y0 * rr, r.y1 * rr - dpr);
      const padAngle = Math.min((r.x1 - r.x0) / 2, 0.005);
      // padRadius matches d3-shape: padRadius * 1.5
      const padR = rr * 1.5;
      const halfPad = padAngle > 0 && padR > 0 ? Math.asin(padAngle / 2 / padR) * 2 : 0;
      const startAngle = r.x0 + halfPad - Math.PI / 2;
      const endAngle   = r.x1 - halfPad - Math.PI / 2;
      if (endAngle <= startAngle) continue;

      const fill = fillMapRef.current.get(key) ?? '#555';
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      // The ghost ring (one level beyond the solid rings) is drawn at a flat,
      // reduced opacity — faded but uniform, no radial gradient.
      const depth = nodeDataRef.current.get(key)?.depth;
      if (depth === visibleRings + 1) {
        ctx.fillStyle = withAlpha(fill, 0.32);
        ctx.fill();
        // No stroke on ghost arcs — keep them airy.
      } else {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = '#13161f';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }

    // Labels (drawn after all arcs so they sit on top)
    const fontSize = (isMobile ? 16 : 12.5) * dpr;
    ctx.font = `600 ${fontSize}px DM Sans, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const [key, r] of rendered) {
      if (!rectVisible(r)) continue;
      // Same visibility threshold as SVG version
      if ((r.y1 - r.y0) <= 0.4 || (r.y1 - r.y0) * (r.x1 - r.x0) <= 0.04) continue;
      const nd = nodeDataRef.current.get(key);
      if (!nd?.san) continue;
      if (isMobile && nd.depth > 2) continue;
      if (nd.depth === visibleRings + 1) continue; // ghost ring: no labels

      const midAngle = (r.x0 + r.x1) / 2 - Math.PI / 2;
      const midR = ((r.y0 + r.y1) / 2) * rr;
      const lx = cx + Math.cos(midAngle) * midR;
      const ly = cy + Math.sin(midAngle) * midR;

      ctx.save();
      ctx.translate(lx, ly);
      // Rotate label to follow arc tangent, flipping for bottom half
      let rot = midAngle + Math.PI / 2;
      if (rot > Math.PI / 2 && rot < (3 * Math.PI) / 2) rot += Math.PI;
      ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(0,0,0,0.67)';
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeText(nd.san, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(nd.san, 0, 0);
      ctx.restore();
    }

    const highlightedKey = highlightedArcKeyRef.current;
    const highlightedRect = highlightedKey ? rendered.get(highlightedKey) : null;
    if (highlightedRect && rectVisible(highlightedRect)) {
      const innerR = highlightedRect.y0 * rr;
      const outerR = Math.max(highlightedRect.y0 * rr, highlightedRect.y1 * rr - dpr);
      const padAngle = Math.min((highlightedRect.x1 - highlightedRect.x0) / 2, 0.005);
      const padR = rr * 1.5;
      const halfPad = padAngle > 0 && padR > 0 ? Math.asin(padAngle / 2 / padR) * 2 : 0;
      const startAngle = highlightedRect.x0 + halfPad - Math.PI / 2;
      const endAngle = highlightedRect.x1 - halfPad - Math.PI / 2;
      if (endAngle > startAngle) {
        ctx.save();
        ctx.beginPath();
        const inset = 3 * dpr;
        ctx.arc(cx, cy, outerR - inset, startAngle, endAngle);
        ctx.arc(cx, cy, innerR + inset, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(230,196,25,0.45)';
        ctx.shadowBlur = 8 * dpr;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 5 * dpr;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#e6c419';
        ctx.lineWidth = 2.25 * dpr;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Outer separator ring.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * dpr - dpr, 0, 2 * Math.PI);
    ctx.strokeStyle = '#252836';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }

  // ─── rAF loop ─────────────────────────────────────────────────────────────
  const rafLoopRef = useRef<() => void>(() => {});
  rafLoopRef.current = () => {
    const now = performance.now();
    let allDone = true;
    const rendered = renderedRectsRef.current;

    for (const [key, anim] of animMap.current) {
      const elapsed = Math.max(0, now - anim.startedAt);
      const t = Math.min(1, elapsed / ANIM_MS);
      rendered.set(key, lerpRect(anim.start, anim.target, easeInOut(t)));
      if (t < 1) allDone = false;
    }

    paintCanvas(rendered);

    if (!allDone) {
      rafRef.current = requestAnimationFrame(() => rafLoopRef.current());
    } else {
      rafRef.current = null;
    }
  };

  function ensureRafRunning() {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => rafLoopRef.current());
    }
  }

  // ─── Animation effect ─────────────────────────────────────────────────────
  useEffect(() => {
    const prevFocus = prevFocusPathRef.current;
    const sameFocus = sameArray(prevFocus, focusPath);
    const drilledIn =
      focusPath.length > prevFocus.length && arrayStartsWith(focusPath, prevFocus);
    const drilledOut =
      focusPath.length < prevFocus.length && arrayStartsWith(prevFocus, focusPath);

    // Build global-key → last-rendered-rect map for position inheritance.
    const prevPainted = renderedRectsRef.current;
    const prevGlobal = new Map<string, Rect>();
    for (const [k, r] of prevPainted.entries()) {
      const globalKey = [...prevFocus, ...(k === 'root' ? [] : k.split('>'))].join('>');
      prevGlobal.set(globalKey, r);
    }

    const now = performance.now();

    if (sameFocus) {
      // ── Data update (streaming / filter change) ──────────────────────────
      const snapAll = justZoomedRef.current;
      justZoomedRef.current = false;

      for (const n of nodes) {
        if (n.depth === 0 || n.depth > maxDepth) continue;
        const key = pathKey(n);
        const newTarget = targetForArc(n);
        if (snapAll) {
          animMap.current.set(key, { start: newTarget, target: newTarget, startedAt: now });
        } else {
          const existing = animMap.current.get(key);
          if (existing) {
            const currentRect = renderedRectsRef.current.get(key) ?? existing.start;
            animMap.current.set(key, { start: currentRect, target: newTarget, startedAt: now });
          } else {
            const collapsed = { x0: newTarget.x0, x1: newTarget.x1, y0: newTarget.y0, y1: newTarget.y0 };
            animMap.current.set(key, { start: collapsed, target: newTarget, startedAt: now });
          }
        }
      }
      // Remove arcs that disappeared (pruned out).
      const currentKeys = new Set(nodes.map((n) => pathKey(n)));
      for (const key of animMap.current.keys()) {
        if (!currentKeys.has(key)) animMap.current.delete(key);
      }
    } else {
      // ── Focus change (zoom in/out) or fresh render ────────────────────────
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      animMap.current.clear();
      renderedRectsRef.current.clear();

      const isFocusChange = drilledIn || drilledOut;
      if (isFocusChange) justZoomedRef.current = true;

      for (const n of nodes) {
        if (n.depth === 0 || n.depth > maxDepth) continue;
        const key = pathKey(n);
        const tgt = targetForArc(n);

        if (isFocusChange) {
          // Snap immediately — no animation on zoom.
          animMap.current.set(key, { start: tgt, target: tgt, startedAt: now });
        } else {
          // Initial render — snap immediately.
          animMap.current.set(key, { start: tgt, target: tgt, startedAt: now });
        }
      }
    }

    prevFocusPathRef.current = focusPath;
    ensureRafRunning();

    // Mark that we need to re-derive hover once the new nodes are available.
    if (!sameFocus) pendingHoverUpdate.current = true;

    return () => {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData, focusPath.join('>')]);

  const renderableNodes = useMemo(
    () => nodes.filter((n) => n.depth > 0 && n.depth <= maxDepth),
    [nodes, maxDepth],
  );

  // ─── Hover re-detection after focus change ───────────────────────────────
  // Runs whenever nodes changes (i.e. when new rootData arrives after a click).
  // Geometrically hit-tests the stored cursor position against the new arc layout.
  useEffect(() => {
    if (!pendingHoverUpdate.current) return;
    if (!lastMousePos.current) {
      pendingHoverUpdate.current = false;
      return;
    }
    pendingHoverUpdate.current = false;

    const { x, y } = lastMousePos.current;
    const hit = getNodeAtClientPoint(x, y);
    if (hit) {
      setHover({ node: hit.data, x, y });
      evalCache.onHover(hit.data.fen);
    } else {
      setHover(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  function getChartPoint(clientX: number, clientY: number) {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const chartX = (clientX - rect.left) * (size / rect.width) - radius;
    const chartY = (clientY - rect.top) * (size / rect.height) - radius;
    const dist = Math.sqrt(chartX * chartX + chartY * chartY);
    const yUnit = dist / ringRadius;
    // d3-shape arc: angle 0 = top (-y in SVG coords), increasing clockwise.
    let angle = Math.atan2(chartX, -chartY);
    if (angle < 0) angle += 2 * Math.PI;

    return { dist, yUnit, angle };
  }

  function getNodeAtClientPoint(clientX: number, clientY: number): SunburstNode | null {
    const point = getChartPoint(clientX, clientY);
    if (!point) return null;
    return renderableNodes.find((n) => {
      const tgt = targetForArc(n);
      if (point.yUnit < tgt.y0 || point.yUnit >= tgt.y1) return false;
      return point.angle >= tgt.x0 && point.angle < tgt.x1;
    }) ?? null;
  }

  function isInHole(clientX: number, clientY: number): boolean {
    const point = getChartPoint(clientX, clientY);
    return point != null && point.dist <= holeRadius;
  }

  function handlePointerMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    lastMousePos.current = { x: ev.clientX, y: ev.clientY };
    const hit = getNodeAtClientPoint(ev.clientX, ev.clientY);
    if (!hit) {
      setHover(null);
      return;
    }
    setHover({ node: hit.data, x: ev.clientX, y: ev.clientY });
    evalCache.onHover(hit.data.fen);
  }

  function handlePointerClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (isMobile) {
      if (clickHandledByPointerRef.current) {
        clickHandledByPointerRef.current = false;
        ev.preventDefault();
      }
      return;
    }
    const hit = getNodeAtClientPoint(ev.clientX, ev.clientY);
    if (hit) {
      handleClickArc(hit);
      return;
    }
    if (focusPath.length > 0 && isInHole(ev.clientX, ev.clientY)) {
      handleZoomOut();
    }
  }

  function highlightArc(n: SunburstNode) {
    highlightedArcKeyRef.current = pathKey(n);
    paintCanvas(renderedRectsRef.current);
  }

  function handlePointerDown(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!isMobile) return;
    const hit = getNodeAtClientPoint(ev.clientX, ev.clientY);
    if (!hit) return;
    // Ignore the 3rd ring outward (and the ghost ring beyond it): no preview,
    // no highlight — leave it untouched.
    if (hit.depth >= 3) return;
    ev.preventDefault();
    activeMobilePointerRef.current = { pointerId: ev.pointerId, key: pathKey(hit) };
    setMobileInfo(hit.data);
    evalCache.onHover(hit.data.fen);
    highlightArc(hit);
  }

  function handlePointerUp(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!isMobile) return;
    ev.preventDefault();
    const active = activeMobilePointerRef.current;
    activeMobilePointerRef.current = null;
    if (!active || active.pointerId !== ev.pointerId) return;
    const hit = getNodeAtClientPoint(ev.clientX, ev.clientY);
    if (!hit || pathKey(hit) !== active.key) return;
    clickHandledByPointerRef.current = true;
    handleClickArc(hit);
  }

  function handlePointerCancel(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!isMobile) return;
    if (activeMobilePointerRef.current?.pointerId === ev.pointerId) {
      activeMobilePointerRef.current = null;
    }
  }

  const handleClickArc = (n: SunburstNode) => {
    const local = localPath(n);
    if (local.length === 0) return;
    if (isMobile) {
      if (n.depth >= 3) return;
      setMobileInfo(n.data);
      evalCache.onHover(n.data.fen);
      highlightArc(n);
      if (mobileZoomTimeoutRef.current != null) {
        window.clearTimeout(mobileZoomTimeoutRef.current);
      }
      // Play every move on the clicked path sequentially (a 2nd-ring arc is two
      // moves), animating into each one rather than only the first.
      mobileZoomTimeoutRef.current = window.setTimeout(() => {
        highlightedArcKeyRef.current = null;
        mobileZoomTimeoutRef.current = null;
        forwardHistoryRef.current = [];
        drillTo([...focusPath, ...local]);
      }, MOBILE_ZOOM_DELAY_MS);
      return;
    }
    forwardHistoryRef.current = [];
    drillTo([...focusPath, ...local]);
  };

  // Zoom straight to `target` in one step. A clicked 2nd-ring arc is two moves;
  // we jump to the final position rather than stepping through the intermediate
  // one, so there's a single smooth zoom instead of a pause-then-quickfire as
  // each intermediate snapshot loads. Play the sound of the last move played.
  const drillTo = (target: string[]) => {
    const lastMove = target[target.length - 1];
    if (lastMove) playMoveSound(lastMove);
    onFocusChange(target);
  };

  const handleZoomOut = () => {
    if (focusPath.length === 0) return;
    if (isMobile) setMobileInfo(null);
    playSound('navigate');
    forwardHistoryRef.current = [focusPath[focusPath.length - 1], ...forwardHistoryRef.current];
    onFocusChange(focusPath.slice(0, -1));
  };

  const handleZoomForward = () => {
    const next = forwardHistoryRef.current[0];
    if (!next) return;
    if (isMobile) setMobileInfo(null);
    playMoveSound(next);
    forwardHistoryRef.current = forwardHistoryRef.current.slice(1);
    onFocusChange([...focusPath, next]);
  };

  const handleReset = () => {
    if (isMobile) setMobileInfo(null);
    forwardHistoryRef.current = [];
    onFocusChange([]);
  };

  // Keyboard arrow navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); handleZoomOut(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleZoomForward(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPath]);

  // Rebuild fill + node-data maps whenever nodes or colorMode changes.
  useEffect(() => {
    for (const d of renderableNodes) {
      const key = pathKey(d);
      const parent = d.parent as SunburstNode | null;
      const siblingIndex = parent?.children?.indexOf(d) ?? 0;
      const local = localPath(d);
      fillMapRef.current.set(key, colorMode === 'winrate'
        ? colorForWinRate(winRate(d.data), d.depth)
        : colorForLocalPath(local, d.depth, siblingIndex, focusPath.length));
      nodeDataRef.current.set(key, { san: d.data.san ?? null, depth: d.depth });
    }
    paintCanvas(renderedRectsRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableNodes, colorMode]);

  // Keep canvas sized to device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size * CANVAS_DPR;
    canvas.height = size * CANVAS_DPR;
    paintCanvas(renderedRectsRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const focusFen = rootData.fen || STARTING_FEN;
  focusFenRef.current = focusFen;

  // Top 5 immediate continuations from the focused position, by game count.
  const topLines = useMemo(
    () => [...rootData.children].sort((a, b) => b.count - a.count).slice(0, 5),
    [rootData],
  );

  useEffect(() => {
    if (onTopLinesChange) onTopLinesChange(topLines);
  }, [topLines, onTopLinesChange]);
  const focusEval = evalCache.getEval(focusFen);
  const focusPositionEval = stockfish.getPositionEval(focusFen);

  // Only show the best-move arrow if it's ≥50cp better than all played children.
  const focusBestMove = (() => {
    if (!engineEnabled) return null;
    const bm = focusPositionEval?.bestMove;
    if (!bm) return null;
    // Collect evals for all first-ring children (moves played in games).
    const childEvals = rootData.children
      .map((c) => stockfish.getPositionEval(c.fen)?.eval)
      .filter((e): e is NonNullable<typeof e> => e !== undefined && e !== null);
    // Need at least one child eval to make the comparison.
    if (childEvals.length === 0) return null;
    const toCp = (e: NonNullable<typeof childEvals[0]>) =>
      e.type === 'mate' ? (e.value > 0 ? 10000 : -10000) : e.value;
    // From white's POV: best child eval is the max (white prefers higher).
    // If it's black's turn, white prefers lower — we flip sign.
    const sideToMove = focusFen.split(' ')[1];
    const sign = sideToMove === 'w' ? 1 : -1;
    const bestChildCp = Math.max(...childEvals.map((e) => sign * toCp(e)));
    const focusCp = focusEval ? sign * toCp(focusEval) : null;
    if (focusCp === null) return null;
    // The best move is "better" if remaining eval stays close to focusCp,
    // but all played children drop ≥50cp below it.
    if (focusCp - bestChildCp >= 50) return bm;
    return null;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', overflow: 'visible' }}>
    <div ref={containerRef} style={{ ...touchSurfaceStyle, position: 'relative', zIndex: 1, width: '100%', maxWidth: size, height: 'auto', aspectRatio: '1 / 1', margin: '0 auto', overflow: 'visible', contain: 'layout' }}>
      {/* Canvas: draws all arcs + labels */}
      <canvas
        ref={canvasRef}
        width={size * CANVAS_DPR}
        height={size * CANVAS_DPR}
        style={{ ...touchSurfaceStyle, display: 'block', width: '100%', height: 'auto', position: 'absolute', inset: 0, borderRadius: '50%', cursor: 'pointer' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseMove={handlePointerMove}
        onClick={handlePointerClick}
        onMouseLeave={() => { lastMousePos.current = null; setHover(null); evalCache.onLeave(); }}
      />

      {/* Colour-by toggle (cycles Opening ↔ Win rate) plus a mute toggle beneath
          it. Sits in the top-right corner of the chart's bounding box, clear of
          the inscribed circle. Mobile only — on desktop the sidebar controls
          cover these. Right-aligned so both tiles hang off the same edge. */}
      {onColorModeChange && isMobile && (
        <div style={{
          position: 'absolute', top: 2, right: 2, zIndex: 3,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
        }}>
          <button
            type="button"
            onClick={() => onColorModeChange(colorMode === 'opening' ? 'winrate' : 'opening')}
            title={colorMode === 'opening' ? 'Colour: opening (tap for win rate)' : 'Colour: win rate (tap for opening)'}
            aria-label="Toggle colour mode"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: colorMode === 'winrate' ? 'var(--accent)' : 'rgba(13,15,22,0.85)',
              color: colorMode === 'winrate' ? '#111' : 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '6px 9px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 11, fontWeight: 600, backdropFilter: 'blur(2px)',
            }}
          >
            <Palette size={15} />
            {colorMode === 'winrate' ? 'Win rate' : 'Opening'}
          </button>
          {onSoundToggle && (
            <button
              type="button"
              onClick={() => onSoundToggle(!soundOn)}
              title={soundOn ? 'Sound on (tap to mute)' : 'Muted (tap to unmute)'}
              aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
              aria-pressed={!soundOn}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(13,15,22,0.85)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '6px 9px', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 600, backdropFilter: 'blur(2px)',
              }}
            >
              {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
          )}
        </div>
      )}

      <CenterBoard
        fen={hover?.node.fen ?? focusFen}
        size={boardSize}
        containerSize={size}
        orientation={color}
        hoverSan={hover?.node.san ?? null}
        hoverFromFen={focusFen}
        bestMoveUci={focusBestMove}
      />

      <Tooltip
        node={isMobile ? null : (hover?.node ?? null)}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        totalGames={totalGames}
        eval_={hover ? evalCache.getEval(hover.node.fen) : undefined}
      />

      {focusPath.length > 0 && isMobile && (
        <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 10 }}>
          <ArrowLeft size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleZoomOut} aria-label="Back one move" />
          <ArrowLeftFromLine size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleReset} aria-label="Reset to start" />
        </div>
      )}

      {/* Top-left: back arrows + position info in the gutter, clear of the rings. Hidden on narrow/mobile (shown in sidebar). */}
      {!isMobile && !isNarrow && (
        <div style={{
          position: 'absolute',
          left: -75,
          top: 6,
          width: 150,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'none',
        }}>
          {focusPath.length > 0 && (
            <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
              <ArrowLeft size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleZoomOut} aria-label="Back one move" />
              <ArrowLeftFromLine size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleReset} aria-label="Reset to start" />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              {totalGames.toLocaleString()} games
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.35, wordBreak: 'break-word' }}>
              Depth {focusPath.length} · {focusPath.length === 0 ? 'start' : focusPath.join(' ')}
            </span>
            {openingName && (
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.35, marginTop: 1 }}>
                {openingName}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Top-right: top lines panel — pushed ~half its width out past the chart's right edge,
          into the gutter beside the eval bar so it sits clear of the rings. Hidden on narrow/mobile. */}
      {!isMobile && !isNarrow && topLines.length > 0 && (
        <div style={{
          position: 'absolute',
          right: -110,
          top: 6,
          width: 158,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            marginBottom: 1,
            textAlign: 'right',
          }}>
            Top Lines
          </span>
          {topLines.map((line, i) => {
            const lTotal = line.wins + line.draws + line.losses;
            const winPct = lTotal > 0 ? (line.wins / lTotal) * 100 : 0;
            const drawPct = lTotal > 0 ? (line.draws / lTotal) * 100 : 0;
            const lossPct = lTotal > 0 ? (line.losses / lTotal) * 100 : 0;
            const wrPct = lTotal > 0 ? Math.round((line.wins + 0.5 * line.draws) / lTotal * 100) : 0;
            const wrColor = wrPct >= 55 ? 'var(--win)' : wrPct <= 45 ? 'var(--loss)' : 'var(--text-dim)';
            return (
              <div
                key={(line.san ?? '?') + i}
                onClick={() => {
                  if (!line.san) return;
                  const target = nodes.find((n) => n.depth === 1 && n.data.san === line.san);
                  if (target) handleClickArc(target);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  width: '100%',
                  boxSizing: 'border-box',
                  cursor: line.san ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, width: '100%' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{line.san ?? '—'}</span>
                  <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.count.toLocaleString()} games played</span>
                  <span style={{ color: wrColor, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right', fontWeight: 600 }}>{wrPct}%</span>
                </div>
                <div style={{ display: 'flex', height: 5, width: '100%', borderRadius: 2, overflow: 'hidden', background: 'var(--surface)' }}>
                  <div style={{ width: `${winPct}%`, background: 'var(--win)' }} />
                  <div style={{ width: `${drawPct}%`, background: 'var(--text-dim)' }} />
                  <div style={{ width: `${lossPct}%`, background: 'var(--loss)' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {engineEnabled && !isMobile && !isNarrow && <EvalBar eval_={focusEval} height={size * 0.7} />}
    </div>
    {engineEnabled && isNarrow && (
      <div style={{ width: '100%', maxWidth: size, margin: '10px auto 0', boxSizing: 'border-box' }}>
        <EvalBar eval_={focusEval} height={0} horizontal />
      </div>
    )}
    {engineEnabled && isMobile && (
      <div style={{ width: '100%', maxWidth: size, margin: '8px auto 0', boxSizing: 'border-box', padding: '0 8px' }}>
        <EvalBar eval_={focusEval} height={0} horizontal hideLabel />
      </div>
    )}
    {isMobile && !mobileInfo && topLines.length > 0 && (
      <div style={{ width: '100%', maxWidth: size, margin: '8px auto 0', boxSizing: 'border-box', padding: '0 8px' }}>
        <div style={{
          background: 'rgba(13,15,22,0.97)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          color: 'var(--text)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 2 }}>
              Top Lines
            </span>
            {topLines.map((line, i) => {
              const lTotal = line.wins + line.draws + line.losses;
              const winPct = lTotal > 0 ? (line.wins / lTotal) * 100 : 0;
              const drawPct = lTotal > 0 ? (line.draws / lTotal) * 100 : 0;
              const lossPct = lTotal > 0 ? (line.losses / lTotal) * 100 : 0;
              const wrPct = lTotal > 0 ? Math.round((line.wins + 0.5 * line.draws) / lTotal * 100) : 0;
              const wrColor = wrPct >= 55 ? 'var(--win)' : wrPct <= 45 ? 'var(--loss)' : 'var(--text-dim)';
              return (
                <div
                  key={(line.san ?? '?') + i}
                  onClick={() => {
                    if (!line.san) return;
                    const target = nodes.find((n) => n.depth === 1 && n.data.san === line.san);
                    if (target) handleClickArc(target);
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: line.san ? 'pointer' : 'default' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{line.san ?? '-'}</span>
                    <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.count.toLocaleString()} games played</span>
                    <span style={{ color: wrColor, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right', fontWeight: 600 }}>{wrPct}%</span>
                  </div>
                  <div style={{ display: 'flex', height: 5, width: '100%', borderRadius: 2, overflow: 'hidden', background: 'var(--surface)', opacity: 0.58 }}>
                    <div style={{ width: `${winPct}%`, background: 'var(--win)' }} />
                    <div style={{ width: `${drawPct}%`, background: 'var(--text-dim)' }} />
                    <div style={{ width: `${lossPct}%`, background: 'var(--loss)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}
    {isMobile && mobileInfo && (() => {
      const node = mobileInfo;
      const eval_ = evalCache.getEval(node.fen);
      const wr = Math.round(winRate(node) * 100);
      const pct = totalGames > 0 ? Math.round((node.count / totalGames) * 100) : 0;
      const total = node.wins + node.draws + node.losses;
      const winPct  = total > 0 ? (node.wins  / total) * 100 : 0;
      const drawPct = total > 0 ? (node.draws / total) * 100 : 0;
      const lossPct = total > 0 ? (node.losses / total) * 100 : 0;
      const evalColor =
        eval_ == null ? 'var(--text-muted)'
        : eval_.type === 'mate' ? '#f4d03f'
        : eval_.value > 30 ? 'var(--win)'
        : eval_.value < -30 ? 'var(--loss)'
        : 'var(--text)';
      const evalStr = eval_ === undefined ? '…' : eval_ === null ? '-' : formatEval(eval_);
      const moveOrder = [...focusPath, node.san ?? ''].filter(Boolean);
      return (
        <div style={{ width: '100%', maxWidth: size, margin: '8px auto 0', boxSizing: 'border-box', padding: '0 8px' }}>
          <div style={{
            background: 'rgba(13,15,22,0.97)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: 'inherit',
            color: 'var(--text)',
          }}>
            {/* Top row: left=stats, right=move order */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 7 }}>
              <div style={{ flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{node.san ?? 'Start'}</span>
                  {engineEnabled && <span style={{ color: evalColor, fontWeight: 600, fontSize: 13 }}>{evalStr}</span>}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {node.count.toLocaleString()} games ({pct}%)
                </div>
              </div>
              <div style={{ flex: 1, textAlign: 'right', color: '#444c5e', fontSize: 11, lineHeight: 1.7, paddingTop: 1 }}>
                {moveOrder.map((san, i) => (
                  <span key={i}>
                    {i % 2 === 0 && <span style={{ color: '#333a4d' }}>{Math.floor(i / 2) + 1}. </span>}
                    <span style={{ color: i === moveOrder.length - 1 ? 'var(--text-muted)' : '#444c5e' }}>{san} </span>
                  </span>
                ))}
              </div>
            </div>
            {/* W/D/L bar — full width */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ flex: 1, borderRadius: 3, overflow: 'hidden', display: 'flex', height: 6 }}>
                <div style={{ width: `${winPct}%`,  background: 'var(--win)',      transition: 'width 0.2s' }} />
                <div style={{ width: `${drawPct}%`, background: 'var(--text-dim)', transition: 'width 0.2s' }} />
                <div style={{ width: `${lossPct}%`, background: 'var(--loss)',     transition: 'width 0.2s' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--win)', flexShrink: 0 }}>{wr}%</span>
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
              <span style={{ color: 'var(--win)' }}>{node.wins.toLocaleString()}W</span>
              <span style={{ color: 'var(--text-muted)' }}>{node.draws.toLocaleString()}D</span>
              <span style={{ color: 'var(--loss)' }}>{node.losses.toLocaleString()}L</span>
            </div>
            {topLines.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 2 }}>
                  Top Lines
                </span>
                {topLines.map((line, i) => {
                  const lTotal = line.wins + line.draws + line.losses;
                  const winPct = lTotal > 0 ? (line.wins / lTotal) * 100 : 0;
                  const drawPct = lTotal > 0 ? (line.draws / lTotal) * 100 : 0;
                  const lossPct = lTotal > 0 ? (line.losses / lTotal) * 100 : 0;
                  const wrPct = lTotal > 0 ? Math.round((line.wins + 0.5 * line.draws) / lTotal * 100) : 0;
                  const wrColor = wrPct >= 55 ? 'var(--win)' : wrPct <= 45 ? 'var(--loss)' : 'var(--text-dim)';
                  return (
                    <div
                      key={(line.san ?? '?') + i}
                      onClick={() => {
                        if (!line.san) return;
                        const target = nodes.find((n) => n.depth === 1 && n.data.san === line.san);
                        if (target) handleClickArc(target);
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: line.san ? 'pointer' : 'default' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{line.san ?? '—'}</span>
                        <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.count.toLocaleString()} games played</span>
                        <span style={{ color: wrColor, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right', fontWeight: 600 }}>{wrPct}%</span>
                      </div>
                      <div style={{ display: 'flex', height: 5, width: '100%', borderRadius: 2, overflow: 'hidden', background: 'var(--surface)', opacity: 0.58 }}>
                        <div style={{ width: `${winPct}%`, background: 'var(--win)' }} />
                        <div style={{ width: `${drawPct}%`, background: 'var(--text-dim)' }} />
                        <div style={{ width: `${lossPct}%`, background: 'var(--loss)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    })()}
    </div>
  );
}

// Convert a #rrggbb (or #rgb) hex colour to an rgba() string with the given alpha.
function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex; // not hex — leave as-is
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function arrayStartsWith(a: string[], prefix: string[]): boolean {
  if (prefix.length > a.length) return false;
  for (let i = 0; i < prefix.length; i++) if (a[i] !== prefix[i]) return false;
  return true;
}
