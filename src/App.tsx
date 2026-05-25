import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Filter, Platform, SnapshotRequest } from './types';
import { DEFAULT_GAME_LIMIT, DEFAULT_VIEW_DEPTH } from './types';
import { UserForm } from './ui/UserForm';
import { SunburstSkeleton } from './ui/SunburstSkeleton';
import { Filters } from './ui/Filters';
import { ColorToggle } from './ui/ColorToggle';
import { LoadingBoard } from './ui/LoadingBoard';
import { Sunburst } from './vis/Sunburst';
import type { SunburstHandle } from './vis/Sunburst';
import { GameReplay } from './vis/GameReplay';
import { useAggregator, EMPTY_ROOT } from './hooks/useAggregator';
import type { SerializedNode } from './types';
import { useGameSync } from './hooks/useGameSync';
import { useOpeningName } from './hooks/useOpeningName';
import { clearUser, findGameByMoves } from './store/cache';
import { encodeShareUrl, decodeShareUrl } from './lib/shareUrl';

interface Session {
  platform: Platform;
  username: string;
}

const DEFAULT_FILTER: Filter = {
  timeClasses: ['bullet', 'blitz', 'rapid', 'classical'],
  limit: DEFAULT_GAME_LIMIT,
};


function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

function App() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const [session, setSession] = useState<Session | null>(() => {
    const s = decodeShareUrl();
    return s ? { platform: s.platform, username: s.username } : null;
  });
  const [color, setColor] = useState<Color>(() => decodeShareUrl()?.color ?? 'white');
  const [filter, setFilter] = useState<Filter>(() => decodeShareUrl()?.filter ?? DEFAULT_FILTER);
  const [focusPath, setFocusPath] = useState<string[]>(() => decodeShareUrl()?.focusPath ?? []);
  const [reloadCount, setReloadCount] = useState(0);
  const [copyLabel, setCopyLabel] = useState<'Copy link' | 'Copied!'>('Copy link');
  const [fullGameMoves, setFullGameMoves] = useState<string[] | null>(null);
  const [fullGameId, setFullGameId] = useState<string | null>(null);
  const sunburstRef = useRef<SunburstHandle>(null);

  const request: SnapshotRequest = useMemo(
    () => ({ focusPath, depth: DEFAULT_VIEW_DEPTH }),
    [focusPath],
  );

  const { client, snapshot, error: workerError } = useAggregator(color, filter, request);
  const { state: sync, start } = useGameSync();

  useEffect(() => { setFocusPath([]); }, [color]);
  useEffect(() => { setFocusPath([]); }, [session?.platform, session?.username]);

  useEffect(() => {
    if (!session) return;
    void start({
      client,
      platform: session.platform,
      username: session.username,
      color,
      filter,
      request,
      limit: filter.limit,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, client, reloadCount]);

  // Keep URL hash in sync with current view state.
  useEffect(() => {
    if (!session) { history.replaceState(null, '', window.location.pathname); return; }
    const url = encodeShareUrl({ platform: session.platform, username: session.username, color, filter, focusPath });
    history.replaceState(null, '', url);
  }, [session, color, filter, focusPath]);

  const handleCopyLink = () => {
    if (!session) return;
    const url = encodeShareUrl({ platform: session.platform, username: session.username, color, filter, focusPath });
    void navigator.clipboard.writeText(url).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy link'), 2000);
    });
  };

  const handleRefresh = async () => {
    if (!session) return;
    if (!confirm(`Re-fetch all games for ${session.username}? This clears the cached copy.`)) return;
    await clearUser(session.platform, session.username);
    setFocusPath([]);
    setReloadCount((n) => n + 1);
  };


  const root = snapshot?.root ?? EMPTY_ROOT;
  const total = snapshot?.totalGames ?? 0;
  // Use the focusPath that matches the current snapshot, not the live UI state.
  // This keeps (root, snapshotFocusPath) consistent until the next snapshot arrives,
  // eliminating the intermediate choppy state between a click and the new data.
  const snapshotFocusPath = snapshot?.focusPath ?? focusPath;
  const openingName = useOpeningName(focusPath);

  useEffect(() => {
    setFullGameMoves(null);
    setFullGameId(null);
    if (!session || total !== 1) return;
    void findGameByMoves(session.platform, session.username, focusPath).then((game) => {
      if (game) { setFullGameMoves(game.moves); setFullGameId(game.id); }
    });
  }, [session, total, focusPath]);

  return (
    <div style={{ minHeight: '100vh', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header — only shown once a session is active ── */}
      {session && <header style={headerStyle}>
        <div style={{ maxWidth: 1280, margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.webp" alt="Logo" onClick={() => setSession(null)} style={{ width: 28, height: 28, objectFit: 'contain', cursor: 'pointer' }} />
            {!isMobile && (
              <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: 'var(--text)' }}>
                Chess Opening Visualiser
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleRefresh} style={headerBtnStyle} className="header-btn">
              {isMobile ? 'Refresh' : 'Refresh games'}
            </button>
            <button type="button" onClick={() => setSession(null)} style={headerBtnStyle} className="header-btn">
              {isMobile ? 'Change' : 'Change user'}
            </button>
          </div>
        </div>
      </header>}

      {/* ── Main ── */}
      <main style={{ flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: isMobile ? '0 16px 40px' : '0 24px 40px' }}>
        {!session && <LandingView onSubmit={(p, u) => setSession({ platform: p, username: u })} isMobile={isMobile} />}

        {session && (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 32, alignItems: 'flex-start', paddingTop: 24 }}>
            {/* ── Left sidebar ── */}
            <aside style={isMobile ? { ...sidebarStyle, width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10, order: 2 } : sidebarStyle}>
              {/* Platform + username identity (username is editable) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 8px', ...(isMobile ? { width: '100%' } : {}) }}>
                <button
                  type="button"
                  title={`Switch to ${session.platform === 'lichess' ? 'Chess.com' : 'Lichess'}`}
                  onClick={() => setSession({ ...session, platform: session.platform === 'lichess' ? 'chesscom' : 'lichess' })}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                >
                  <img
                    src={session.platform === 'lichess' ? '/lichesslogo.webp' : '/chesscomlogo.webp'}
                    alt={session.platform}
                    style={{
                      width: 18,
                      height: 18,
                      objectFit: 'contain',
                      filter: session.platform === 'lichess' ? 'invert(1)' : 'none',
                      opacity: 0.7,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                  />
                </button>
                <input
                  key={session.username}
                  defaultValue={session.username}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') { e.currentTarget.value = session.username; e.currentTarget.blur(); }
                  }}
                  onBlur={(e) => {
                    const next = e.currentTarget.value.trim();
                    if (next && next !== session.username) setSession({ ...session, username: next });
                    else e.currentTarget.value = session.username;
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid transparent',
                    outline: 'none',
                    fontWeight: 600,
                    fontSize: 14,
                    color: 'var(--text)',
                    letterSpacing: '-0.01em',
                    fontFamily: 'inherit',
                    padding: '1px 0',
                    width: '100%',
                    cursor: 'text',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'var(--accent)'; }}
                  onBlurCapture={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
                />
              </div>

              <div style={isMobile ? { ...controlCardStyle, width: '100%' } : controlCardStyle}>
                <div style={{ marginBottom: 14 }}>
                  <label style={controlLabelStyle}>Playing as</label>
                  <ColorToggle value={color} onChange={setColor} />
                </div>
                <div>
                  <label style={controlLabelStyle}>Filters</label>
                  <Filters value={filter} onChange={setFilter} />
                </div>
              </div>

              {/* Lichess analysis link */}
              <a
                href={`https://lichess.org/analysis/${(snapshot?.root?.fen ?? '').replace(/ /g, '_')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={lichessBtnStyle}
                className="header-btn"
              >
                Analyse on Lichess ↗
              </a>

              {/* Export chart */}
              {sync.status === 'done' && total > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const name = `${session.username}-openings${focusPath.length ? '-' + focusPath.join('-') : ''}.png`;
                    void sunburstRef.current?.exportPng(name);
                  }}
                  style={lichessBtnStyle}
                  className="header-btn"
                >
                  Export PNG ↓
                </button>
              )}

              {/* Share link */}
              <button
                type="button"
                onClick={handleCopyLink}
                style={lichessBtnStyle}
                className="header-btn"
              >
                {copyLabel}
              </button>

              {workerError && (
                <div style={{ color: '#f88', fontSize: 12, padding: '8px 0' }}>
                  Worker error: {workerError}
                </div>
              )}

              {(sync.status === 'fetching' || sync.status === 'loading-cache') && (
                <div style={statusCardStyle}>
                  <Spinner />
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {sync.status === 'loading-cache'
                      ? 'Loading cached games…'
                      : `Fetching… ${sync.fetched}${sync.fromCache ? ` (+${sync.fromCache} cached)` : ''}`}
                  </span>
                </div>
              )}

              {sync.status === 'done' && total > 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{total.toLocaleString()} games</span>
                  <span style={{ color: 'var(--text-dim)' }}>
                    Depth {focusPath.length} · {focusPath.length === 0 ? 'start' : focusPath.join(' ')}
                  </span>
                  {openingName && (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>
                      {openingName.name}
                    </span>
                  )}
                </div>
              )}
            </aside>

            {/* ── Right: chart or loading ── */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minWidth: 0, width: '100%', ...(isMobile ? { order: 1 } : {}) }}>
              {sync.status === 'done' && total === 1 ? (
                <GameReplay
                  focusPath={focusPath}
                  remainingMoves={
                    fullGameMoves
                      ? fullGameMoves.slice(focusPath.length)
                      : extractRemainingMoves(root)
                  }
                  orientation={color}
                  gameId={fullGameId ?? undefined}
                  onBackToChart={() => setFocusPath([])}
                  isMobile={isMobile}
                />
              ) : sync.status === 'done' && total > 1 ? (
                <Sunburst
                  root={root}
                  totalGames={total}
                  color={color}
                  focusPath={snapshotFocusPath}
                  onFocusChange={setFocusPath}
                  size={680}
                  isMobile={isMobile}
                  visibleRings={isMobile ? 3 : undefined}
                  holeUnits={isMobile ? 7 : undefined}
                  exportRef={sunburstRef}
                />
              ) : sync.status === 'done' ? (
                <div style={{ color: 'var(--text-muted)', padding: 48, fontSize: 14 }}>
                  No games found for this user/filter combination.
                </div>
              ) : (
                <LoadingBoard state={sync} isMobile={isMobile} />
              )}
            </div>
          </div>
        )}
      </main>

      <footer style={footerStyle}>
        <a href="https://gooseworks.io/" target="_blank" rel="noopener noreferrer" className="gooseworks-link">
          <img src="/GooseworksLogoWhite.webp" alt="Gooseworks" className="gooseworks-logo" />
        </a>
        <span className="footer-sep">·</span>
        <span>
          Data from{' '}
          <a href="https://www.chess.com/news/view/published-data-api" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>Chess.com API</a>
          {' '}and{' '}
          <a href="https://lichess.org/api" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>Lichess API</a>
          {' '}· Opening names from{' '}
          <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>lichess-org/chess-openings</a>
          {' '}· Inspired by{' '}
          <a href="https://www.openingtree.com/" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>OpeningTree</a>
          {' '}and{' '}
          <a href="https://blog.ebemunk.com/a-visual-look-at-2-million-chess-games/" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>@ebemunk</a>
          {' '}data visualisations
          {' '}· Built with{' '}
          <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>chess.js</a>
          {' '}and{' '}
          <a href="https://github.com/Clariity/react-chessboard" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>react-chessboard</a>
        </span>
      </footer>

      <style>{`
        .header-btn:hover { background: #333847 !important; color: #e8eaf0 !important; }
        .chip-btn:hover { filter: brightness(1.15); }
        .platform-btn:hover { border-color: var(--border-hover) !important; }
        .platform-btn.selected:hover { border-color: var(--accent-hover) !important; }
        footer a:hover { color: var(--text-muted) !important; }
        .gooseworks-logo { height: 64px; width: auto; opacity: 0.5; transition: opacity 0.15s; }
        .gooseworks-link:hover .gooseworks-logo { opacity: 0.85; }
        .footer-sep { margin: 0 6px; color: var(--text-dim); }
        @media (max-width: 767px) {
          .footer-sep { display: none; }
          footer { flex-direction: column !important; gap: 8px !important; padding: 12px 16px !important; font-size: 10px !important; }
        }
      `}</style>
    </div>
  );
}


// Walk a single-game chain from the snapshot root and collect remaining SANs.
function extractRemainingMoves(node: SerializedNode): string[] {
  const moves: string[] = [];
  let cur = node;
  while (cur.children.length > 0) {
    const next = cur.children[0];
    if (!next.san) break;
    moves.push(next.san);
    cur = next;
  }
  return moves;
}

function LandingView({ onSubmit, isMobile }: {
  onSubmit: (p: Platform, u: string) => void;
  isMobile: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 16px',
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Skeleton sunburst — decorative backdrop */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
        <SunburstSkeleton size={isMobile ? 320 : 600} />
      </div>

      {/* Foreground content */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)', textAlign: 'center' }}>
            Visualise your <span style={{ color: 'var(--accent)' }}>openings</span>
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 400 }}>
            Explore your most-played openings as white and black
          </p>
        </div>
        <UserForm onSubmit={onSubmit} isMobile={isMobile} />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      width: 12, height: 12,
      border: '2px solid var(--accent)',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'cv-spin 0.8s linear infinite',
      flexShrink: 0,
    }} />
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const headerStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderBottom: '1px solid var(--border)',
  padding: '0 24px',
  height: 52,
  display: 'flex',
  alignItems: 'center',
  position: 'sticky',
  top: 0,
  zIndex: 20,
};

const headerBtnStyle: React.CSSProperties = {
  background: '#252836',
  color: 'var(--text-muted)',
  border: 'none',
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  transition: 'background 0.15s, color 0.15s',
};

const sidebarStyle: React.CSSProperties = {
  width: 260,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingTop: 4,
};

const controlCardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '16px 16px 14px',
};

const controlLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-dim)',
  marginBottom: 8,
};

const lichessBtnStyle: React.CSSProperties = {
  display: 'block',
  background: '#252836',
  color: 'var(--text-muted)',
  border: 'none',
  padding: '8px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
  textAlign: 'center',
  transition: 'background 0.15s, color 0.15s',
};

const statusCardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};


const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: '12px 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 4,
  fontSize: 11,
  color: 'var(--text-dim)',
  lineHeight: 1.6,
};

const footerLinkStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  transition: 'color 0.15s',
};

export default App;
