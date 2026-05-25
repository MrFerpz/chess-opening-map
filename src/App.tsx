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

function KnightIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 232.523 232.523" fill="currentColor">
      <path d="M191.981,186.136c2.459-26.64,5.491-124.514-73.554-181.851L112.52,0l-8.45,17.83L71.919,6.041l7.338,41.919
        c-14.624,9.853-35.107,25.227-45.82,40.37c-6.452,9.111-7.19,20.091-1.998,30.124c6.623,12.8,21.19,20.366,35.178,18.031
        c11.724-1.956,25.005-8.281,33.993-13.181C97.595,144.116,87.003,186,50.676,186v0.124H39.277v46.399h165.236v-46.399h-12.531
        V186.136z M87.476,24.633l11.396,4.182l-4.504,9.511c-0.979,0.588-2.376,1.434-4.061,2.482L87.476,24.633z M113.882,112.257
        l0.375-11.585l-9.714,6.307c-0.23,0.148-22.848,14.724-39.916,17.572c-9.031,1.502-18.255-3.546-22.437-11.652
        c-1.788-3.449-4.014-10.323,1.126-17.564c15.917-22.473,58.339-47.259,58.765-47.508l1.625-0.943l13.45-28.375
        c23.979,19.113,39.123,42.445,48.598,65.707l-29.571-5.375l-2.163,11.913l36.522,6.638c3.062,9.522,5.272,18.879,6.827,27.786
        l-32.391-5.887l-2.164,11.904l36.416,6.62c0.981,8.369,1.407,16.112,1.549,22.993l-34.921-6.349l-2.151,11.916l36.984,6.715
        c-0.178,5.426-0.526,9.835-0.834,12.933H84.249C105.675,167.83,113.194,133.358,113.882,112.257z M192.419,220.43H51.397v-22.188
        h141.022V220.43z"/>
      <circle cx="99.041" cy="78.641" r="9.671"/>
    </svg>
  );
}

function App() {
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
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <KnightIcon size={28} />
            </span>
            <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: 'var(--text)' }}>
              Chess Opening Visualiser
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleRefresh} style={headerBtnStyle} className="header-btn">
              Refresh games
            </button>
            <button type="button" onClick={() => setSession(null)} style={headerBtnStyle} className="header-btn">
              Change user
            </button>
          </div>
        </div>
      </header>}

      {/* ── Main ── */}
      <main style={{ flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '0 24px 40px' }}>
        {!session && <LandingView onSubmit={(p, u) => setSession({ platform: p, username: u })} />}

        {session && (
          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', paddingTop: 24 }}>
            {/* ── Left sidebar ── */}
            <aside style={sidebarStyle}>
              {/* Platform + username identity (username is editable) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 8px' }}>
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

              <div style={controlCardStyle}>
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
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
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
                />
              ) : sync.status === 'done' && total > 1 ? (
                <Sunburst
                  root={root}
                  totalGames={total}
                  color={color}
                  focusPath={focusPath}
                  onFocusChange={setFocusPath}
                  size={680}
                  exportRef={sunburstRef}
                />
              ) : sync.status === 'done' ? (
                <div style={{ color: 'var(--text-muted)', padding: 48, fontSize: 14 }}>
                  No games found for this user/filter combination.
                </div>
              ) : (
                <LoadingBoard state={sync} />
              )}
            </div>
          </div>
        )}
      </main>

      <footer style={footerStyle}>
        <span>
          Data from{' '}
          <a href="https://www.chess.com/news/view/published-data-api" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>Chess.com API</a>
          {' '}and{' '}
          <a href="https://lichess.org/api" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>Lichess API</a>
          {' '}· Opening names from{' '}
          <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>lichess-org/chess-openings</a>
          {' '}· Inspired by{' '}
          <a href="https://blog.ebemunk.com/a-visual-look-at-2-million-chess-games/" target="_blank" rel="noopener noreferrer" style={footerLinkStyle}>@ebemunk</a>
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

function LandingView({ onSubmit }: {
  onSubmit: (p: Platform, u: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Skeleton sunburst — decorative backdrop */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
        <SunburstSkeleton size={600} />
      </div>

      {/* Foreground content */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
        <h2 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)', textAlign: 'center' }}>
          Visualise your <span style={{ color: 'var(--accent)' }}>openings</span>
        </h2>
        <UserForm onSubmit={onSubmit} />
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
  textAlign: 'center',
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
