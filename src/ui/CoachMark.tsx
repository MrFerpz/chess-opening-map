import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  target: HTMLElement | null;
  text: string;
  step: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}

const CARD_W = 260;

// A single coach-mark popover anchored to a target element. Highlights the
// target with a ring and places a card above or below it (whichever fits).
// Re-measures on scroll/resize so it tracks the target. Mirrors the portal +
// viewport-clamping approach used by vis/Tooltip.tsx.
export function CoachMark({ target, text, step, total, onNext, onSkip }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(() => target?.getBoundingClientRect() ?? null);

  useEffect(() => {
    if (!target) { setRect(null); return; }
    const measure = () => setRect(target.getBoundingClientRect());
    measure();
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target]);

  if (!target || !rect || typeof document === 'undefined') return null;

  const margin = 8;
  const gap = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // Prefer below the target; flip above if there's not enough room.
  const placeBelow = rect.bottom + gap + 140 < viewportH;
  const top = placeBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - 140);

  // Centre the card on the target horizontally, clamped to the viewport.
  const centredLeft = rect.left + rect.width / 2 - CARD_W / 2;
  const left = Math.max(margin, Math.min(centredLeft, viewportW - CARD_W - margin));

  const isLast = step === total - 1;

  return createPortal(
    <>
      {/* Highlight ring around the target */}
      <div
        style={{
          position: 'fixed',
          left: rect.left - 6,
          top: rect.top - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          borderRadius: 10,
          border: '2px solid var(--accent)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          pointerEvents: 'none',
          zIndex: 1100,
          transition: 'all 0.2s ease',
        }}
      />
      {/* Popover card */}
      <div
        style={{
          position: 'fixed',
          left,
          top,
          width: CARD_W,
          boxSizing: 'border-box',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          zIndex: 1101,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{text}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {step + 1} / {total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isLast && (
              <button
                onClick={onSkip}
                style={{
                  padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
                }}
              >
                Skip
              </button>
            )}
            <button
              onClick={onNext}
              className="chip-btn"
              style={{
                padding: '6px 16px', borderRadius: 7, border: 'none',
                background: 'var(--accent)', color: '#0c0e14', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
