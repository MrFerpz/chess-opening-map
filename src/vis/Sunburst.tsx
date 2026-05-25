import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Color, SerializedNode } from '../types';
import { STARTING_FEN } from '../types';
import {
  buildHierarchy,
  easeInOut,
  HOLE_UNITS,
  labelTransform,
  labelVisible,
  lerpRect,
  localPath,
  makeArc,
  pathKey,
  rectVisible,
  targetFor,
  VISIBLE_RINGS,
  type Rect,
  type SunburstNode,
} from './sunburstLayout';
import { colorForLocalPath, winRate } from './colorScale';
import { CenterBoard } from './CenterBoard';
import { Tooltip } from './Tooltip';
import { EvalBar } from './EvalBar';
import { formatEval } from '../hooks/useCloudEval';
import { useStockfish } from '../hooks/useStockfish';
import { drawBoardOnCanvas } from './boardToCanvas';
import { ArrowLeft, ArrowLeftFromLine } from 'lucide-react';

export interface SunburstHandle {
  exportPng: (filename?: string) => Promise<void>;
}

interface Props {
  root: SerializedNode;
  totalGames: number;
  color: Color;
  focusPath: string[];
  onFocusChange: (newPath: string[]) => void;
  size?: number;
  exportRef?: React.Ref<SunburstHandle>;
  isMobile?: boolean;
  visibleRings?: number;
  holeUnits?: number;
}

const ANIM_MS = 350;

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
  focusPath,
  onFocusChange,
  size = 720,
  exportRef,
  isMobile,
  visibleRings: visibleRingsProp,
  holeUnits: holeUnitsProp,
}: Props) {
  const visibleRings = visibleRingsProp ?? VISIBLE_RINGS;
  const holeUnits = holeUnitsProp ?? HOLE_UNITS;
  const [hover, setHover] = useState<{
    node: SerializedNode;
    x: number;
    y: number;
  } | null>(null);
  const [mobileInfo, setMobileInfo] = useState<SerializedNode | null>(null);
  const stockfish = useStockfish();
  const evalCache = {
    onHover: (fen: string) => { void stockfish.enqueue(fen); },
    onLeave: () => {},
    getEval: (fen: string) => stockfish.getPositionEval(fen)?.eval,
  };

  // Remember the last child entered at each depth so → can re-enter it.
  const forwardHistoryRef = useRef<string[]>([]);

  // Fetch eval for the current focus position.
  useEffect(() => {
    const fen = rootData.fen || STARTING_FEN;
    void stockfish.enqueue(fen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData.fen]);

  const radius = size / 2;
  const ringRadius = radius / (holeUnits + visibleRings);
  const holeRadius = ringRadius * holeUnits;
  const boardSize = Math.floor(holeRadius * Math.SQRT2);

  const arcGen = useMemo(() => makeArc(ringRadius), [ringRadius]);

  const hierarchyRoot = useMemo(() => buildHierarchy(rootData), [rootData]);
  const nodes = useMemo(
    () => hierarchyRoot.descendants() as SunburstNode[],
    [hierarchyRoot],
  );

  // Per-pathKey animation state (source of truth for the rAF loop).
  const animMap = useRef<Map<string, ArcAnim>>(new Map());
  // Current interpolated rect — what was last painted.
  const renderedRectsRef = useRef<Map<string, Rect>>(new Map());

  // Refs into the DOM for imperative updates (bypasses React reconciliation).
  const pathRefsRef = useRef<Map<string, SVGPathElement>>(new Map());
  const textRefsRef = useRef<Map<string, SVGTextElement>>(new Map());
  // Fill colours kept in sync with the current focusPath so the rAF loop
  // can stamp the correct colour at the same moment it makes an arc visible.
  const fillMapRef = useRef<Map<string, string>>(new Map());

  const rafRef = useRef<number | null>(null);
  const prevFocusPathRef = useRef<string[]>(focusPath);
  const justZoomedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusFenRef = useRef<string>(STARTING_FEN);
  const colorRef = useRef<Color>(color);
  colorRef.current = color;
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  // Set to true when focusPath changes; cleared after the next hover re-detection.
  const pendingHoverUpdate = useRef(false);

  useImperativeHandle(exportRef, () => ({
    exportPng: async (filename = 'chess-openings.png') => {
      const svg = svgRef.current;
      if (!svg) return;

      const dpr = window.devicePixelRatio || 1;

      // 1. Rasterize the sunburst SVG. Replace the cross-origin font name so
      //    the canvas stays untainted and toBlob() doesn't throw.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(size));
      clone.setAttribute('height', String(size));
      let svgData = new XMLSerializer().serializeToString(clone);
      svgData = svgData.replace(/DM Sans/g, 'system-ui');
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const sunburstImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(svgUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(svgUrl); reject(); };
        img.src = svgUrl;
      });

      // 2. Composite onto a canvas.
      const canvas = document.createElement('canvas');
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.drawImage(sunburstImg, 0, 0, size, size);

      // 3. Draw the board programmatically so we bypass DOM serialization
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

  // ─── rAF loop ────────────────────────────────────────────────────────────
  // Defined once, never recreated. Reads animMap and writes directly to DOM.
  const rafLoopRef = useRef<() => void>(() => {});
  rafLoopRef.current = () => {
    const now = performance.now();
    let allDone = true;
    const rendered = renderedRectsRef.current;

    for (const [key, anim] of animMap.current) {
      const elapsed = Math.max(0, now - anim.startedAt);
      const t = Math.min(1, elapsed / ANIM_MS);
      const r = lerpRect(anim.start, anim.target, easeInOut(t));
      rendered.set(key, r);
      if (t < 1) allDone = false;

      // Imperatively update path element.
      const pathEl = pathRefsRef.current.get(key);
      if (pathEl) {
        if (rectVisible(r)) {
          pathEl.setAttribute('d', arcGen(r) ?? '');
          const fill = fillMapRef.current.get(key);
          if (fill) pathEl.setAttribute('fill', fill);
          pathEl.style.display = '';
        } else {
          pathEl.style.display = 'none';
        }
      }

      // Imperatively update text element.
      const textEl = textRefsRef.current.get(key);
      if (textEl) {
        if (labelVisible(r)) {
          textEl.setAttribute('transform', labelTransform(r, ringRadius));
          textEl.style.display = '';
        } else {
          textEl.style.display = 'none';
        }
      }
    }

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
        if (n.depth === 0 || n.depth > visibleRings) continue;
        const key = pathKey(n);
        const newTarget = targetFor(n, visibleRings, holeUnits);
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
        if (n.depth === 0 || n.depth > visibleRings) continue;
        const key = pathKey(n);
        const tgt = targetFor(n, visibleRings, holeUnits);

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

  // ─── Hover re-detection after focus change ───────────────────────────────
  // Runs whenever nodes changes (i.e. when new rootData arrives after a click).
  // Geometrically hit-tests the stored cursor position against the new arc layout.
  useEffect(() => {
    if (!pendingHoverUpdate.current) return;
    if (!lastMousePos.current || !svgRef.current) {
      pendingHoverUpdate.current = false;
      return;
    }
    pendingHoverUpdate.current = false;

    const { x, y } = lastMousePos.current;
    const svgRect = svgRef.current.getBoundingClientRect();
    const svgX = x - svgRect.left - radius;
    const svgY = y - svgRect.top - radius;
    const dist = Math.sqrt(svgX * svgX + svgY * svgY);
    const yUnit = dist / ringRadius;
    // d3-shape arc: angle 0 = top (−y in SVG coords), increasing clockwise.
    // atan2(svgX, -svgY) gives 0 at top, π/2 at right — matching d3's convention.
    let angle = Math.atan2(svgX, -svgY);
    if (angle < 0) angle += 2 * Math.PI;

    const hit = nodes.find((n) => {
      if (n.depth === 0 || n.depth > visibleRings) return false;
      const tgt = targetFor(n, visibleRings, holeUnits);
      if (yUnit < tgt.y0 || yUnit >= tgt.y1) return false;
      return angle >= tgt.x0 && angle < tgt.x1;
    });

    if (hit) {
      setHover({ node: hit.data, x, y });
      evalCache.onHover(hit.data.fen);
    } else {
      setHover(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleClickArc = (n: SunburstNode) => {
    const local = localPath(n);
    if (local.length === 0) return;
    if (isMobile) {
      setMobileInfo(n.data);
      evalCache.onHover(n.data.fen);
    }
    forwardHistoryRef.current = [];
    onFocusChange([...focusPath, ...local]);
  };

  const handleZoomOut = () => {
    if (focusPath.length === 0) return;
    if (isMobile) setMobileInfo(null);
    forwardHistoryRef.current = [focusPath[focusPath.length - 1], ...forwardHistoryRef.current];
    onFocusChange(focusPath.slice(0, -1));
  };

  const handleZoomForward = () => {
    const next = forwardHistoryRef.current[0];
    if (!next) return;
    if (isMobile) setMobileInfo(null);
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

  // ─── Initial render — stable SVG skeleton ────────────────────────────────
  // React renders <path> / <text> elements once per node set change.
  // The rAF loop mutates their attributes directly; React never touches them again
  // during animation. We use callback refs to register DOM elements.
  const renderableNodes = useMemo(
    () => nodes.filter((n) => n.depth > 0 && n.depth <= visibleRings),
    [nodes],
  );

  const focusFen = rootData.fen || STARTING_FEN;
  focusFenRef.current = focusFen;
  const focusEval = evalCache.getEval(focusFen);
  const focusPositionEval = stockfish.getPositionEval(focusFen);

  // Only show the best-move arrow if it's ≥50cp better than all played children.
  const focusBestMove = (() => {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', overflow: 'hidden' }}>
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: size, height: 'auto', aspectRatio: '1 / 1', margin: '0 auto', overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`${-radius} ${-radius} ${size} ${size}`}
        style={{ display: 'block', userSelect: 'none', width: '100%', height: 'auto' }}
        onMouseMove={(ev) => { lastMousePos.current = { x: ev.clientX, y: ev.clientY }; }}
        onMouseLeave={() => { lastMousePos.current = null; setHover(null); }}
      >
        {/* Background disc */}
        <circle r={radius} fill="#13161f" />
        {/* Subtle outer separator ring */}
        <circle r={radius - 1} fill="none" stroke="#252836" strokeWidth={1.5} />

        <g>
          {renderableNodes.map((d) => {
            const key = pathKey(d);
            const parent = d.parent as SunburstNode | null;
            const siblingIndex = parent?.children?.indexOf(d) ?? 0;
            const local = localPath(d);
            const fill = colorForLocalPath(local, d.depth, siblingIndex, focusPath.length);
            fillMapRef.current.set(key, fill);
            return (
              <path
                key={key}
                ref={(el) => {
                  if (el) pathRefsRef.current.set(key, el);
                  else pathRefsRef.current.delete(key);
                }}
                fill={fill}
                fillOpacity={1}
                stroke="#13161f"
                strokeWidth={1.5}
                style={{ cursor: 'pointer', display: 'none' }}
                onClick={() => handleClickArc(d)}
                onMouseMove={(ev) => {
                  setHover({ node: d.data, x: ev.clientX, y: ev.clientY });
                  evalCache.onHover(d.data.fen);
                }}
                onMouseLeave={() => { setHover(null); evalCache.onLeave(); }}
              />
            );
          })}
        </g>

        <g pointerEvents="none" fill="#fff" style={{ font: '11px/1 DM Sans, system-ui' }}>
          {renderableNodes.map((d) => {
            const key = pathKey(d);
            return (
              <text
                key={'l' + key}
                ref={(el) => {
                  if (el) textRefsRef.current.set(key, el);
                  else textRefsRef.current.delete(key);
                }}
                dy="0.35em"
                textAnchor="middle"
                style={{
                  fontWeight: 600,
                  paintOrder: 'stroke',
                  stroke: '#000b',
                  strokeWidth: 2.5,
                  display: 'none',
                }}
              >
                {d.data.san}
              </text>
            );
          })}
        </g>

        <circle
          r={holeRadius}
          fill="transparent"
          style={{ cursor: focusPath.length > 0 ? 'pointer' : 'default' }}
          onClick={handleZoomOut}
        />
      </svg>

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
        node={hover?.node ?? null}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        totalGames={totalGames}
        eval_={hover ? evalCache.getEval(hover.node.fen) : undefined}
        centreX={svgRef.current ? svgRef.current.getBoundingClientRect().left + size / 2 : undefined}
      />

      {focusPath.length > 0 && (
        <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 10 }}>
          <ArrowLeft size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleZoomOut} title="Back one move" />
          <ArrowLeftFromLine size={20} style={{ cursor: 'pointer', color: '#c8cad8', opacity: 0.8 }} onClick={handleReset} title="Reset to start" />
        </div>
      )}
    </div>
    {!isMobile && <EvalBar eval_={focusEval} height={size * 0.7} />}
    </div>
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
                  <span style={{ color: evalColor, fontWeight: 600, fontSize: 13 }}>{evalStr}</span>
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
          </div>
        </div>
      );
    })()}
    {isMobile && (
      <div style={{ width: '100%', maxWidth: size, margin: '8px auto 0', boxSizing: 'border-box', padding: '0 8px 0 8px' }}>
        <EvalBar eval_={focusEval} height={0} horizontal hideLabel />
      </div>
    )}
    </div>
  );
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
