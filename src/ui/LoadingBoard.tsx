import React, { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { SyncRunState } from '../hooks/useGameSync';
import { STARTING_FEN } from '../types';

interface FamousGame {
  label: string;
  moves: string[];
}

const FAMOUS_GAMES: FamousGame[] = [
  {
    label: 'Immortal Game,Anderssen vs Kieseritzky, 1851',
    moves: [
      'e4','e5','f4','exf4','Bc4','Qh4+','Kf1','b5','Bxb5','Nf6','Nf3','Qh6',
      'd3','Nh5','Nh4','Qg5','Nf5','c6','g4','Nf6','Rg1','cxb5','h4','Qg6',
      'h5','Qg5','Qf3','Ng8','Bxf4','Qf6','Nc3','Bc5','Nd5','Qxb2','Bd6',
      'Bxg1','e5','Qxa1+','Ke2','Na6','Nxg7+','Kd8','Qf6+','Nxf6','Be7#',
    ],
  },
  {
    label: 'Opera Game,Morphy vs Duke of Brunswick, 1858',
    moves: [
      'e4','e5','Nf3','d6','d4','Bg4','dxe5','Bxf3','Qxf3','dxe5','Bc4',
      'Nf6','Qb3','Qe7','Nc3','c6','Bg5','b5','Nxb5','cxb5','Bxb5+','Nbd7',
      'O-O-O','Rd8','Rxd7','Rxd7','Rd1','Qe6','Bxd7+','Nxd7','Qb8+','Nxb8',
      'Rd8#',
    ],
  },
  {
    label: 'Evergreen Game,Anderssen vs Dufresne, 1852',
    moves: [
      'e4','e5','Nf3','Nc6','Bc4','Bc5','b4','Bxb4','c3','Ba5','d4','exd4',
      'O-O','d3','Qb3','Qf6','e5','Qg6','Re1','Nge7','Ba3','b5','Qxb5','Rb8',
      'Qa4','Bb6','Nbd2','Bb7','Ne4','Qf5','Bxd3','Qh5','Nf6+','gxf6','exf6',
      'Rg8','Rad1','Qxf3','Rxe7+','Nxe7','Qxd7+','Kxd7','Bf5+','Ke8','Bd7+',
      'Kf8','Bxe7#',
    ],
  },
  {
    label: "Game of the Century,Byrne vs Fischer, 1956",
    moves: [
      'Nf3','Nf6','c4','g6','Nc3','Bg7','d4','O-O','Bf4','d5','Qb3','dxc4',
      'Qxc4','c6','e4','Nbd7','Rd1','Nb6','Qc5','Bg4','Bg5','Na4','Qa3','Nxc3',
      'bxc3','Nxe4','Bxe7','Qb6','Bc4','Nxc3','Bc5','Rfe8+','Kf1','Be6','Bxb6',
      'Bxc4+','Kg1','Ne2+','Kf1','Nxd4+','Kg1','Ne2+','Kf1','Nc3+','Kg1','axb6',
      'Qb4','Ra4','Qxb6','Nxd1','h3','Rxa2','Kh2','Nxf2','Re1','Rxe1','Qd8+',
      'Bf8','Nxe1','Bd5','Nf3','Ne4','Qb8','b5','h4','h5','Ne5','Kg7','Kg1',
      'Bc5+','Kf1','Ng3+','Ke1','Bb4+','Kd1','Bb3+','Kc1','Ne2+','Kb1','Nc3+',
      'Kc1','Rc2#',
    ],
  },
  {
    label: 'Deep Blue vs Kasparov, Game 2, 1997',
    moves: [
      'e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5',
      'Bb3','d6','c3','O-O','h3','Nb8','d4','Nbd7','Nbd2','Bb7','Bc2','Re8',
      'Nf1','Bf8','Ng3','g6','a4','c5','d5','c4','b4','cxb3','Bxb3','a5',
      'Bb5','Bc8','Bc6','Rb8','Bd3','Bg7','Nh2','Nh5','Nxh5','gxh5','Qg4',
      'Kh8','Bf5','Nf6','Qf3','Ng8','Bxc8','Rxc8','Be3','Nf6','Rad1','Nh7',
      'Qg3','Rb8','Rd2','Qf6','Rf1','a4','Rdf2','Qg6','Qxg6','fxg6','b5','Rf8',
      'Nd2','Nf6','Nc4','Nd7','Nb6','Nxb6','axb6','Rb7','c4','Rbb8','Rc1','Rbc8',
      'c5','dxc5','Rxc5','Rxc5','Bxc5','Rd8','b6','Rb8','Bd6','Rxb6','Rc2','Rb1+',
      'Kh2','Bf8','Bxf8','Rxf8','Rc7',
    ],
  },
];

const MOVE_INTERVAL_MS = 500;
const PAUSE_MS = 1800;
const FACT_INTERVAL_MS = 4000;

const MOTC_GIFS = [
  { src: '/motcRd5.gif',  label: 'Match of the Century: Bobby Fischer vs Boris Spassky Rd 5' },
  { src: '/motcRd6.gif',  label: 'Match of the Century: Bobby Fischer vs Boris Spassky Rd 6' },
  { src: '/motcRd13.gif', label: 'Match of the Century: Bobby Fischer vs Boris Spassky Rd 13' },
];

const FACTS = [
  'There are more possible chess games than atoms in the observable universe.',
  'The word "checkmate" comes from the Persian phrase "Shah Mat",the king is dead.',
  'The longest possible chess game is 5,949 moves.',
  'The first chess computer program was written in 1951 by Alan Turing.',
  'A knight can reach any square on the board in at most 6 moves.',
  'The number of possible unique chess positions is estimated at 10⁴³.',
  'Castling is the only move where two pieces move at once.',
  'Magnus Carlsen became a grandmaster at age 13.',
  'The en passant rule has existed since the 15th century.',
  'Deep Blue defeated Kasparov in 1997,the first computer to beat a world champion in a match.',
  'The folded paper analogy: if you folded a chessboard\'s 64 squares onto each other, the stack would reach the sun.',
  'Bobby Fischer could play chess blindfolded against multiple opponents simultaneously.',
  'The Immortal Game (1851) is considered the greatest attacking game ever played.',
  'Stockfish evaluates ~70 million positions per second on a modern CPU.',
  'There are 400 possible positions after each player\'s first move.',
  'Chess has been played in space,cosmonauts played against ground controllers in 1970.',
];

const stopBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-muted)',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 16px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s, color 0.15s',
};

// Board size and container height are matched to the sunburst view so the board
// sits in the same screen position before and after loading completes.
// Must mirror the holeUnits/visibleRings passed to <Sunburst> in App.tsx.
const SUNBURST_SIZE = 680;

function boardSizeFor(holeUnits: number, visibleRings: number) {
  const ringRadius = (SUNBURST_SIZE / 2) / (holeUnits + visibleRings);
  const holeRadius = ringRadius * holeUnits;
  return Math.floor(holeRadius * Math.SQRT2);
}

interface Props {
  state: SyncRunState;
  isMobile?: boolean;
  onStop?: () => void;
}

export function LoadingBoard({ state, isMobile, onStop }: Props) {
  const holeUnits = isMobile ? 7 : 5;
  const visibleRings = isMobile ? 3 : 6;
  const BOARD_SIZE = boardSizeFor(holeUnits, visibleRings);

  const isWorking = state.status === 'loading-cache' || state.status === 'fetching';

  const [motcGif] = useState(() => MOTC_GIFS[Math.floor(Math.random() * MOTC_GIFS.length)]);
  const [fen, setFen] = useState(STARTING_FEN);
  const [gameLabel, setGameLabel] = useState('');
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [factVisible, setFactVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const factTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isWorking || isMobile) return;

    const game = FAMOUS_GAMES[Math.floor(Math.random() * FAMOUS_GAMES.length)];
    setGameLabel(game.label);

    const chess = new Chess();
    let moveIndex = 0;

    function step() {
      if (moveIndex < game.moves.length) {
        try { chess.move(game.moves[moveIndex]); } catch { /* skip illegal */ }
        setFen(chess.fen());
        moveIndex++;
        timerRef.current = setTimeout(step, MOVE_INTERVAL_MS);
      } else {
        // Pause at final position, then reset and replay.
        timerRef.current = setTimeout(() => {
          chess.reset();
          moveIndex = 0;
          setFen(STARTING_FEN);
          timerRef.current = setTimeout(step, MOVE_INTERVAL_MS);
        }, PAUSE_MS);
      }
    }

    timerRef.current = setTimeout(step, 400);

    // Rotate facts with a fade-out/fade-in.
    factTimerRef.current = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => {
        setFactIndex((i) => (i + 1) % FACTS.length);
        setFactVisible(true);
      }, 400);
    }, FACT_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (factTimerRef.current) clearInterval(factTimerRef.current);
    };
  }, [isWorking]);

  let statusLabel = '';
  if (state.status === 'loading-cache') statusLabel = 'Loading cached games…';
  else if (state.status === 'fetching') {
    const progress = state.limit != null
      ? `${state.fetched} / ${state.limit}`
      : `${state.fetched}`;
    const cached = state.fromCache ? ` · ${state.fromCache} cached` : '';
    statusLabel = `Fetching… ${progress} games${cached}`;
  } else if (state.status === 'error') statusLabel = `Error: ${state.error ?? 'unknown'}`;

  const showStop = state.status === 'fetching' && state.fetched > 0 && onStop;

  const boardOffset = (SUNBURST_SIZE - BOARD_SIZE) / 2;

  const scale = isMobile ? Math.min(1, (window.innerWidth - 32) / SUNBURST_SIZE) : 1;
  const scaledHeight = SUNBURST_SIZE * scale;

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden', height: scaledHeight }}>
    <div style={{ position: 'relative', width: SUNBURST_SIZE, height: SUNBURST_SIZE, flexShrink: 0, ...(isMobile ? { transform: `scale(${scale})`, transformOrigin: 'top center' } : {}) }}>
      {/* Status label + spinner above the board (mobile only) */}
      {isMobile && statusLabel && (
        <div
          style={{
            position: 'absolute',
            top: boardOffset - 110,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg
            width="28" height="28" viewBox="0 0 28 28"
            style={{ animation: 'cv-spin 1s linear infinite' }}
          >
            <circle cx="14" cy="14" r="11" fill="none" stroke="#333" strokeWidth="3" />
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--accent)" strokeWidth="3"
              strokeDasharray="44" strokeDashoffset="33" strokeLinecap="round" />
          </svg>
          <div style={{ color: 'var(--text-muted)', font: '16px system-ui', textAlign: 'center' }}>
            {statusLabel}
          </div>
          {showStop && (
            <button
              type="button"
              onClick={onStop}
              style={stopBtnStyle}
            >
              Stop &amp; visualise
            </button>
          )}
        </div>
      )}

      {/* Status label + spinner above the board (desktop only) */}
      {!isMobile && statusLabel && (
        <div
          style={{
            position: 'absolute',
            top: boardOffset - 110,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg
            width="28" height="28" viewBox="0 0 28 28"
            style={{ animation: isWorking ? 'cv-spin 1s linear infinite' : 'none' }}
          >
            <circle cx="14" cy="14" r="11" fill="none" stroke="#333" strokeWidth="3" />
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--accent)" strokeWidth="3"
              strokeDasharray="44" strokeDashoffset="33" strokeLinecap="round" />
          </svg>
          <div style={{ color: 'var(--text-muted)', font: '700 14px system-ui', textAlign: 'center' }}>
            {statusLabel}
          </div>
          {showStop && (
            <button
              type="button"
              onClick={onStop}
              style={stopBtnStyle}
            >
              Stop &amp; visualise
            </button>
          )}
        </div>
      )}

      {/* Board pinned to exact centre, matching CenterBoard position in Sunburst */}
      <div
        style={{
          position: 'absolute',
          left: boardOffset,
          top: boardOffset,
          width: BOARD_SIZE,
          height: BOARD_SIZE,
          borderRadius: 4,
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        {isMobile ? (
          <img
            src={motcGif.src}
            alt="Chess animation"
            width={BOARD_SIZE}
            height={BOARD_SIZE}
            style={{ display: 'block', width: BOARD_SIZE, height: BOARD_SIZE }}
          />
        ) : (
          <Chessboard
            options={{
              id: 'loading-board',
              position: fen,
              allowDragging: false,
              showNotation: false,
              animationDurationInMs: MOVE_INTERVAL_MS - 60,
            }}
          />
        )}
      </div>

      {/* Labels below the board */}
      <div
        style={{
          position: 'absolute',
          top: boardOffset + BOARD_SIZE + 16,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ color: '#555', font: 'italic 11px system-ui', maxWidth: 280, textAlign: 'center' }}>
          {isMobile ? motcGif.label : gameLabel}
        </div>
        <div
          style={{
            maxWidth: 320,
            textAlign: 'center',
            opacity: factVisible ? 1 : 0,
            transition: 'opacity 0.4s ease',
          }}
        >
          <span style={{ color: 'var(--accent)', font: '13px system-ui', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Did you know?
          </span>
          <div style={{ color: '#ccc', font: '16px/1.5 system-ui', marginTop: 4 }}>
            {FACTS[factIndex]}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
