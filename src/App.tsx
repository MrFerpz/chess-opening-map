import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Filter, Platform, RatingBand, SnapshotRequest, SpeedPreset, TimeClass } from './types';
import { DEFAULT_GAME_LIMIT, DEFAULT_VIEW_DEPTH, DEFAULT_BAND, DEFAULT_EXPLORER_SPEEDS } from './types';
import { UserForm } from './ui/UserForm';
import { RatingBandForm } from './ui/RatingBandForm';
import { SunburstSkeleton } from './ui/SunburstSkeleton';
import { Filters } from './ui/Filters';
import { ColorToggle } from './ui/ColorToggle';
import { LoadingBoard } from './ui/LoadingBoard';
import { Sunburst, type TopLine, type ColorMode } from './vis/Sunburst';
import type { SunburstHandle } from './vis/Sunburst';
import { GameReplay, type GameMeta } from './vis/GameReplay';
import { useAggregator, EMPTY_ROOT } from './hooks/useAggregator';
import { useExplorer } from './hooks/useExplorer';
import type { SerializedNode } from './types';
import { useGameSync } from './hooks/useGameSync';
import { useOpeningName } from './hooks/useOpeningName';
import { clearUser, findGameByMoves } from './store/cache';
import { encodeShareUrl, decodeShareUrl } from './lib/shareUrl';
import { ConfirmModal } from './ui/ConfirmModal';
import { CoachMark } from './ui/CoachMark';
import { useOnboarding } from './hooks/useOnboarding';
import { isSoundEnabled, setSoundEnabled } from './lib/sounds';
import { checkUserExists } from './api/platform';
import { Volume2, VolumeX } from 'lucide-react';

interface Session {
  platform: Platform;
  username: string;
}

interface ExplorerSession {
  band: RatingBand;
  speeds: TimeClass[];
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
  const isNarrow = windowWidth < 1200 && !isMobile;
  const [session, setSession] = useState<Session | null>(() => {
    const s = decodeShareUrl();
    return s && s.mode === 'user' ? { platform: s.platform, username: s.username } : null;
  });
  const [explorerSession, setExplorerSession] = useState<ExplorerSession | null>(() => {
    const s = decodeShareUrl();
    return s && s.mode === 'explorer' ? { band: s.band, speeds: s.speeds } : null;
  });
  const [color, setColor] = useState<Color>(() => decodeShareUrl()?.color ?? 'white');
  const [filter, setFilter] = useState<Filter>(() => {
    const s = decodeShareUrl();
    return s && s.mode === 'user' ? s.filter : DEFAULT_FILTER;
  });
  const [focusPath, setFocusPath] = useState<string[]>(() => decodeShareUrl()?.focusPath ?? []);
  const [reloadCount, setReloadCount] = useState(0);
  const [copyLabel, setCopyLabel] = useState<'Copy link' | 'Copied!'>('Copy link');
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [fullGameMoves, setFullGameMoves] = useState<string[] | null>(null);
  const [fullGameId, setFullGameId] = useState<string | null>(null);
  const [fullGameMeta, setFullGameMeta] = useState<GameMeta | null>(null);
  // Engine defaults off on touch devices — local Stockfish competes with
  // animations for CPU there. User choice is persisted.
  const [engineEnabled, setEngineEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('engine-enabled');
    if (stored != null) return stored === 'true';
    return !window.matchMedia?.('(pointer: coarse)').matches;
  });
  useEffect(() => {
    localStorage.setItem('engine-enabled', String(engineEnabled));
  }, [engineEnabled]);
  const [narrowTopLines, setNarrowTopLines] = useState<TopLine[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>('opening');
  // Sound on/off — the canonical value + persistence live in lib/sounds.ts; this
  // mirror exists only to drive a re-render of the toggle.
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const sunburstRef = useRef<SunburstHandle>(null);

  // ── Onboarding ──
  const onboarding = useOnboarding();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const playingAsRef = useRef<HTMLDivElement>(null);
  const colourByRef = useRef<HTMLDivElement>(null);
  const [coachStep, setCoachStep] = useState(0);

  const request: SnapshotRequest = useMemo(
    () => ({ focusPath, depth: DEFAULT_VIEW_DEPTH }),
    [focusPath],
  );

  const isExplorer = explorerSession != null;

  const { client, snapshot, error: workerError } = useAggregator(color, filter, request);
  const { state: sync, start, stop } = useGameSync();
  const explorer = useExplorer(
    color,
    explorerSession?.band ?? DEFAULT_BAND,
    explorerSession?.speeds ?? DEFAULT_EXPLORER_SPEEDS,
    focusPath,
    DEFAULT_VIEW_DEPTH,
  );

  useEffect(() => { setFocusPath([]); }, [color]);
  useEffect(() => { setFocusPath([]); }, [session?.platform, session?.username]);
  useEffect(() => { setFocusPath([]); }, [explorerSession?.band.min, explorerSession?.speeds.join(',')]);

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
    if (explorerSession) {
      const url = encodeShareUrl({ mode: 'explorer', band: explorerSession.band, speeds: explorerSession.speeds, color, focusPath });
      history.replaceState(null, '', url);
      return;
    }
    if (!session) { history.replaceState(null, '', window.location.pathname); return; }
    const url = encodeShareUrl({ mode: 'user', platform: session.platform, username: session.username, color, filter, focusPath });
    history.replaceState(null, '', url);
  }, [session, explorerSession, color, filter, focusPath]);

  const handleCopyLink = () => {
    let url: string;
    if (explorerSession) {
      url = encodeShareUrl({ mode: 'explorer', band: explorerSession.band, speeds: explorerSession.speeds, color, focusPath });
    } else if (session) {
      url = encodeShareUrl({ mode: 'user', platform: session.platform, username: session.username, color, filter, focusPath });
    } else {
      return;
    }
    void navigator.clipboard.writeText(url).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy link'), 2000);
    });
  };

  const handleRefresh = () => {
    if (!session) return;
    setConfirmRefresh(true);
  };

  const doRefresh = async () => {
    if (!session) return;
    setConfirmRefresh(false);
    await clearUser(session.platform, session.username);
    setFocusPath([]);
    setReloadCount((n) => n + 1);
  };


  // Pick the active data source.
  const activeSnapshot = isExplorer ? explorer.snapshot : snapshot;
  const root = activeSnapshot?.root ?? EMPTY_ROOT;
  const total = activeSnapshot?.totalGames ?? 0;
  // Use the focusPath that matches the current snapshot, not the live UI state.
  // This keeps (root, snapshotFocusPath) consistent until the next snapshot arrives,
  // eliminating the intermediate choppy state between a click and the new data.
  const snapshotFocusPath = activeSnapshot?.focusPath ?? focusPath;
  const openingName = useOpeningName(focusPath);

  // A view is "ready to render the chart" once we have data.
  const chartReady = isExplorer
    ? (explorer.status === 'done' || total > 1)
    : sync.status === 'done';
  const dataError = isExplorer ? explorer.error : workerError;

  useEffect(() => {
    setFullGameMoves(null);
    setFullGameId(null);
    setFullGameMeta(null);
    if (!session || total !== 1) return;
    void findGameByMoves(session.platform, session.username, focusPath).then((game) => {
      if (game) {
        setFullGameMoves(game.moves);
        setFullGameId(game.id);
        setFullGameMeta({
          oppName: game.oppName ?? null,
          oppRating: game.oppRating,
          playedAt: game.playedAt,
          timeClass: game.timeClass,
          result: game.result,
        });
      }
    });
  }, [session, total, focusPath]);

  const hasSession = session != null || explorerSession != null;
  const clearSession = () => { setSession(null); setExplorerSession(null); };

  // Coach-mark sequence. Marks with a missing target (e.g. single-game replay
  // view has no sunburst) are filtered out so we never point at nothing. Targets
  // are resolved from refs in an effect (after the chart has mounted), not during
  // render, then held in state for the CoachMark popover to anchor to.
  const chartLoaded = hasSession && chartReady && total > 1;
  const showCoach = onboarding.showCoachMarks && chartLoaded;
  const [coachSteps, setCoachSteps] = useState<{ target: HTMLDivElement; text: string }[]>([]);
  useEffect(() => {
    if (!showCoach) { setCoachSteps([]); return; }
    const candidates = [
      { target: chartContainerRef.current, text: 'Click any ring to zoom into that line. Click the centre to step back out.' },
      { target: colourByRef.current, text: 'Switch to Win rate to colour each move green (winning) or red (losing).' },
      {
        target: playingAsRef.current,
        text: isExplorer
          ? 'Switch between games played as White and Black in this rating band.'
          : 'Switch between your games as White and Black.',
      },
    ];
    setCoachSteps(candidates.filter((s): s is { target: HTMLDivElement; text: string } => s.target != null));
  }, [showCoach, isExplorer]);
  const activeCoach = coachSteps[coachStep];
  const advanceCoach = () => {
    if (coachStep + 1 >= coachSteps.length) { onboarding.finish(); setCoachStep(0); }
    else setCoachStep(coachStep + 1);
  };
  const skipCoach = () => { onboarding.finish(); setCoachStep(0); };

  return (
    <div style={{ minHeight: '100vh', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {activeCoach && (
        <CoachMark
          target={activeCoach.target}
          text={activeCoach.text}
          step={coachStep}
          total={coachSteps.length}
          onNext={advanceCoach}
          onSkip={skipCoach}
        />
      )}
      {confirmRefresh && session && (
        <ConfirmModal
          message={`Re-fetch all games for ${session.username}? This clears the cached copy.`}
          onConfirm={() => { void doRefresh(); }}
          onCancel={() => setConfirmRefresh(false)}
        />
      )}
      {/* ── Header — only shown once a session is active ── */}
      {hasSession && <header style={isMobile ? { ...headerStyle, padding: '0 12px' } : headerStyle}>
        <div style={{ maxWidth: 1280, margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.webp" alt="Logo" onClick={clearSession} style={{ width: 36, height: 36, objectFit: 'contain', cursor: 'pointer' }} />
            <span onClick={clearSession} style={{ fontSize: isMobile ? 16 : 18, letterSpacing: '-0.03em', color: 'var(--text)', fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: 'pointer', flexShrink: 0 }}>
              <span style={{ fontWeight: 300 }}>Opening</span><span style={{ fontWeight: 800 }}>Map</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => { setCoachStep(0); onboarding.replay(); }}
              title="Show the quick tour"
              aria-label="Show the quick tour"
              style={{ ...headerBtnStyle, padding: 0, width: 30, height: 30, borderRadius: '50%', fontWeight: 700, lineHeight: 1 }}
              className="header-btn"
            >
              ?
            </button>
            {!isMobile && (
              <button
                type="button"
                onClick={() => { setSoundEnabled(!soundOn); setSoundOn(!soundOn); }}
                title={soundOn ? 'Sound on (click to mute)' : 'Muted (click to unmute)'}
                aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
                aria-pressed={!soundOn}
                style={{ ...headerBtnStyle, padding: 0, width: 30, height: 30, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                className="header-btn"
              >
                {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}
            {session && (
              <button type="button" onClick={handleRefresh} style={isMobile ? { ...headerBtnStyle, padding: '6px 10px' } : headerBtnStyle} className="header-btn">
                {isMobile ? 'Refresh' : 'Refresh games'}
              </button>
            )}
            <button type="button" onClick={clearSession} style={isMobile ? { ...headerBtnStyle, padding: '6px 10px' } : headerBtnStyle} className="header-btn">
              {isExplorer ? (isMobile ? 'Change' : 'Change band') : (isMobile ? 'Change' : 'Change user')}
            </button>
          </div>
        </div>
      </header>}

      {/* ── Main ── */}
      <main style={{ flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: isMobile ? '0 16px 40px' : '0 24px 40px' }}>
        {!hasSession && (
          <LandingView
            onSubmit={(p, u) => setSession({ platform: p, username: u })}
            onExploreBand={(band, preset) => setExplorerSession({ band, speeds: preset.speeds })}
            isMobile={isMobile}
          />
        )}

        {hasSession && (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 32, alignItems: 'flex-start', paddingTop: 24 }}>
            {/* ── Left sidebar ── */}
            <aside style={isMobile ? { ...sidebarStyle, width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10, order: 2 } : sidebarStyle}>
              {/* Explorer band identity */}
              {explorerSession && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 2px 8px', ...(isMobile ? { width: '100%' } : {}) }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                    Rating band
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                    {explorerSession.band.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {explorerSession.speeds.join(', ')}
                  </span>
                </div>
              )}
              {/* Platform + username identity (username is editable) */}
              {session && <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 8px', ...(isMobile ? { width: '100%' } : {}) }}>
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
              </div>}

              <div style={isMobile ? { ...controlCardStyle, width: '100%' } : controlCardStyle}>
                <div style={{ marginBottom: 14 }}>
                  <label style={controlLabelStyle}>Playing as</label>
                  {/* ref sits on the toggle itself so the coach mark highlights the
                      buttons rather than the label + control block. */}
                  <div ref={playingAsRef} style={{ display: 'inline-block' }}>
                    <ColorToggle value={color} onChange={setColor} />
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={controlLabelStyle}>Colour by</label>
                  <div ref={colourByRef} style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    {(['opening', 'winrate'] as const).map((mode) => {
                      const active = colorMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setColorMode(mode)}
                          className="chip-btn"
                          style={{
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#111' : 'var(--text-muted)',
                            border: 'none',
                            padding: '6px 16px',
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: active ? 600 : 400,
                            transition: 'background 0.15s, color 0.15s',
                          }}
                        >
                          {mode === 'opening' ? 'Opening' : 'Win rate'}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={controlLabelStyle}>Engine</label>
                  <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    {([true, false] as const).map((on) => {
                      const active = engineEnabled === on;
                      return (
                        <button
                          key={String(on)}
                          type="button"
                          onClick={() => setEngineEnabled(on)}
                          className="chip-btn"
                          style={{
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#111' : 'var(--text-muted)',
                            border: 'none',
                            padding: '6px 16px',
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: active ? 600 : 400,
                            transition: 'background 0.15s, color 0.15s',
                          }}
                        >
                          {on ? 'On' : 'Off'}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {session && (
                  <div>
                    <label style={controlLabelStyle}>Filters</label>
                    <Filters value={filter} onChange={setFilter} />
                  </div>
                )}
              </div>

              {/* Lichess analysis link */}
              <a
                href={`https://lichess.org/analysis/${(root?.fen ?? '').replace(/ /g, '_')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={lichessBtnStyle}
                className="header-btn"
              >
                Analyse on Lichess ↗
              </a>

              {/* Export chart */}
              {chartReady && total > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const base = explorerSession ? `${explorerSession.band.label}-openings` : `${session?.username}-openings`;
                    const name = `${base}${focusPath.length ? '-' + focusPath.join('-') : ''}.png`;
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

              {dataError && (
                <div style={{ color: '#f88', fontSize: 12, padding: '8px 0' }}>
                  {isExplorer ? 'Explorer error: ' : 'Worker error: '}{dataError}
                </div>
              )}

              {!isExplorer && (sync.status === 'fetching' || sync.status === 'loading-cache') && (
                <div style={statusCardStyle}>
                  <Spinner />
                  <span style={{ color: 'var(--text)', fontSize: 13, flex: 1 }}>
                    {sync.status === 'loading-cache'
                      ? 'Loading cached games…'
                      : `Fetching… ${sync.fetched}${sync.fromCache ? ` (+${sync.fromCache} cached)` : ''}`}
                  </span>
                  {sync.status === 'fetching' && (
                    <button
                      type="button"
                      onClick={stop}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, padding: '2px 8px', cursor: 'pointer', flexShrink: 0 }}
                    >
                      Stop
                    </button>
                  )}
                </div>
              )}

              {isExplorer && explorer.status === 'loading' && (
                <div style={statusCardStyle}>
                  <Spinner />
                  <span style={{ color: 'var(--text)', fontSize: 13, flex: 1 }}>
                    Loading positions…
                  </span>
                </div>
              )}

              {/* Top lines — shown in sidebar when narrow (eval bar + top-lines overlays are hidden on chart) */}
              {isNarrow && chartReady && total > 1 && narrowTopLines.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 2 }}>
                    Top Lines
                  </span>
                  {narrowTopLines.map((line, i) => {
                    const lTotal = line.wins + line.draws + line.losses;
                    const winPct = lTotal > 0 ? (line.wins / lTotal) * 100 : 0;
                    const drawPct = lTotal > 0 ? (line.draws / lTotal) * 100 : 0;
                    const lossPct = lTotal > 0 ? (line.losses / lTotal) * 100 : 0;
                    const sharePct = total > 0 ? Math.round((line.count / total) * 100) : 0;
                    return (
                      <div key={(line.san ?? '?') + i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{line.san ?? '—'}</span>
                          <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.count.toLocaleString()} games played</span>
                          <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>{sharePct}%</span>
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
            </aside>

            {/* ── Right: chart or loading ── */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minWidth: 0, width: '100%', ...(isMobile ? { order: 1 } : {}) }}>
              {chartReady && total > 1 ? (
                <div ref={chartContainerRef} style={{ width: '100%' }}>
                  <Sunburst
                    root={root}
                    totalGames={total}
                    color={color}
                    colorMode={colorMode}
                    onColorModeChange={setColorMode}
                    focusPath={snapshotFocusPath}
                    onFocusChange={setFocusPath}
                    size={680}
                    isMobile={isMobile}
                    isNarrow={isNarrow}
                    visibleRings={isMobile ? 2 : undefined}
                    holeUnits={isMobile ? 4 : undefined}
                    ghostRing={isMobile}
                    exportRef={sunburstRef}
                    openingName={openingName?.name ?? null}
                    onTopLinesChange={setNarrowTopLines}
                    engineEnabled={engineEnabled}
                    soundOn={soundOn}
                    onSoundToggle={(on) => { setSoundEnabled(on); setSoundOn(on); }}
                  />
                </div>
              ) : isExplorer ? (
                explorer.status === 'done' ? (
                  <div style={{ color: 'var(--text-muted)', padding: 48, fontSize: 14 }}>
                    No games found for this band/time-control combination.
                  </div>
                ) : (
                  <SunburstSkeleton size={isMobile ? 320 : 600} />
                )
              ) : sync.status === 'done' && total === 1 ? (
                <GameReplay
                  focusPath={focusPath}
                  remainingMoves={
                    fullGameMoves
                      ? fullGameMoves.slice(focusPath.length)
                      : extractRemainingMoves(root)
                  }
                  orientation={color}
                  gameId={fullGameId ?? undefined}
                  gameMeta={fullGameMeta}
                  onBackToChart={() => setFocusPath([])}
                  isMobile={isMobile}
                  engineEnabled={engineEnabled}
                />
              ) : sync.status === 'done' ? (
                <div style={{ color: 'var(--text-muted)', padding: 48, fontSize: 14 }}>
                  No games found for this user/filter combination.
                </div>
              ) : (
                <LoadingBoard state={sync} isMobile={isMobile} onStop={stop} />
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

function LandingView({ onSubmit, onExploreBand, isMobile }: {
  onSubmit: (p: Platform, u: string) => void;
  onExploreBand: (band: RatingBand, preset: SpeedPreset) => void;
  isMobile: boolean;
}) {
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [landingMode, setLandingMode] = React.useState<'user' | 'explorer'>('user');

  const handleSubmit = async (platform: Platform, username: string) => {
    setError(null);
    setChecking(true);
    try {
      const exists = await checkUserExists(platform, username);
      if (!exists) {
        setError(`User "${username}" not found on ${platform === 'chesscom' ? 'Chess.com' : 'Lichess'}.`);
        return;
      }
      onSubmit(platform, username);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '0 16px 50px' : '0 16px',
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
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)', textAlign: 'center' }}>
            {landingMode === 'user' ? (
              <>Map out your <span style={{ color: 'var(--accent)' }}>openings</span></>
            ) : (
              <>Explore a <span style={{ color: 'var(--accent)' }}>rating band</span></>
            )}
          </h2>
          {landingMode !== 'user' && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 400 }}>
              Browse what players in a rating range actually play, from 100,000s of Lichess games
            </p>
          )}
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {(['user', 'explorer'] as const).map((m) => {
            const active = landingMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setLandingMode(m)}
                className="chip-btn"
                style={{
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#111' : 'var(--text-muted)',
                  border: 'none',
                  padding: '8px 20px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {m === 'user' ? 'Your games' : 'Rating band'}
              </button>
            );
          })}
        </div>

        {landingMode === 'user' ? (
          <UserForm onSubmit={handleSubmit} checking={checking} error={error} isMobile={isMobile} />
        ) : (
          <RatingBandForm onSubmit={onExploreBand} isMobile={isMobile} />
        )}
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
      willChange: 'transform',
      transform: 'translateZ(0)',
      backfaceVisibility: 'hidden',
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
