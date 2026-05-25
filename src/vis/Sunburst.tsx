import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Color, SerializedNode } from '../types';
import { STARTING_FEN } from '../types';
import {
  buildHierarchy,
  collapsedAtCentre,
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
import { colorForLocalPath } from './colorScale';
import { CenterBoard } from './CenterBoard';
import { Tooltip } from './Tooltip';
import { EvalBar } from './EvalBar';
import { useEvalCache } from '../hooks/useCloudEval';
import { drawBoardOnCanvas } from './boardToCanvas';

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
}: Props) {
  const [hover, setHover] = useState<{
    node: SerializedNode;
    x: number;
    y: number;
  } | null>(null);
  const evalCache = useEvalCache(rootData);

  // Pre-fetch eval for the focus position (the board centre).
  useEffect(() => {
    const fen = rootData.fen || STARTING_FEN;
    evalCache.onHover(fen);
    return () => evalCache.onLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData.fen]);

  const radius = size / 2;
  const ringRadius = radius / (HOLE_UNITS + VISIBLE_RINGS);
  const holeRadius = ringRadius * HOLE_UNITS;
  const boardSize = Math.floor(holeRadius * Math.SQRT2 * 1.0);

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

  const rafRef = useRef<number | null>(null);
  const prevFocusPathRef = useRef<string[]>(focusPath);
  const justZoomedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusFenRef = useRef<string>(STARTING_FEN);
  const colorRef = useRef<Color>(color);
  colorRef.current = color;

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
        if (n.depth === 0 || n.depth > VISIBLE_RINGS) continue;
        const key = pathKey(n);
        const newTarget = targetFor(n);
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
        if (n.depth === 0 || n.depth > VISIBLE_RINGS) continue;
        const key = pathKey(n);
        const tgt = targetFor(n);

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

    return () => {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData, focusPath.join('>')]);

  const handleClickArc = (n: SunburstNode) => {
    const local = localPath(n);
    if (local.length === 0) return;
    onFocusChange([...focusPath, ...local]);
  };

  const handleZoomOut = () => {
    if (focusPath.length === 0) return;
    onFocusChange(focusPath.slice(0, -1));
  };

  const handleReset = () => onFocusChange([]);

  // ─── Initial render — stable SVG skeleton ────────────────────────────────
  // React renders <path> / <text> elements once per node set change.
  // The rAF loop mutates their attributes directly; React never touches them again
  // during animation. We use callback refs to register DOM elements.
  const renderableNodes = useMemo(
    () => nodes.filter((n) => n.depth > 0 && n.depth <= VISIBLE_RINGS),
    [nodes],
  );

  const focusFen = rootData.fen || STARTING_FEN;
  focusFenRef.current = focusFen;
  const focusEval = evalCache.getEval(focusFen);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <div ref={containerRef} style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`${-radius} ${-radius} ${size} ${size}`}
        style={{ display: 'block', userSelect: 'none' }}
        onMouseLeave={() => setHover(null)}
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
            const fill = colorForLocalPath(local, d.depth, siblingIndex);
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
        orientation={color}
        hoverSan={hover?.node.san ?? null}
        hoverFromFen={focusFen}
      />

      <Tooltip
        node={hover?.node ?? null}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        totalGames={totalGames}
        eval_={hover ? evalCache.getEval(hover.node.fen) : undefined}
      />

      {focusPath.length > 0 && (
        <button
          type="button"
          onClick={handleReset}
          className="header-btn"
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            background: 'rgba(19,22,31,0.9)',
            color: '#c8cad8',
            border: '1px solid #252836',
            padding: '5px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          ← Reset zoom
        </button>
      )}
    </div>
    <EvalBar eval_={focusEval} height={size * 0.7} />
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
