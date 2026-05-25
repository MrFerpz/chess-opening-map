import { Chess } from 'chess.js';

interface Props {
  fromFen: string;       // FEN of the position BEFORE the move
  san: string;           // SAN of the move to show
  boardSize: number;     // pixel size of the board
  orientation: 'white' | 'black';
}

// Map square name to [col, row] 0-indexed from white's perspective
function squareToColRow(square: string): [number, number] {
  const col = square.charCodeAt(0) - 97; // a=0..h=7
  const row = 8 - parseInt(square[1]);   // rank 8=row0, rank 1=row7
  return [col, row];
}

function squareCenter(square: string, boardSize: number, orientation: 'white' | 'black'): [number, number] {
  let [col, row] = squareToColRow(square);
  if (orientation === 'black') {
    col = 7 - col;
    row = 7 - row;
  }
  const sq = boardSize / 8;
  return [col * sq + sq / 2, row * sq + sq / 2];
}

export function MoveArrow({ fromFen, san, boardSize, orientation }: Props) {
  // Resolve from/to squares via chess.js
  let from: string, to: string;
  try {
    const chess = new Chess(fromFen);
    const move = chess.move(san);
    if (!move) return null;
    from = move.from;
    to = move.to;
  } catch {
    return null;
  }

  const [x1, y1] = squareCenter(from, boardSize, orientation);
  const [x2, y2] = squareCenter(to, boardSize, orientation);

  const sq = boardSize / 8;
  const headLen = sq * 0.38;
  const shaftWidth = sq * 0.18;
  const headWidth = sq * 0.38;

  // Vector from → to
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;

  // Shaft ends slightly before the arrowhead base, starts slightly inside source square
  const startOffset = sq * 0.25;
  const sx = x1 + ux * startOffset;
  const sy = y1 + uy * startOffset;
  const headBaseX = x2 - ux * headLen;
  const headBaseY = y2 - uy * headLen;

  // Perpendicular
  const px = -uy;
  const py = ux;

  // Shaft polygon points
  const shaftPoints = [
    [sx + px * shaftWidth / 2, sy + py * shaftWidth / 2],
    [headBaseX + px * shaftWidth / 2, headBaseY + py * shaftWidth / 2],
    [headBaseX + px * headWidth / 2, headBaseY + py * headWidth / 2],
    [x2, y2],
    [headBaseX - px * headWidth / 2, headBaseY - py * headWidth / 2],
    [headBaseX - px * shaftWidth / 2, headBaseY - py * shaftWidth / 2],
    [sx - px * shaftWidth / 2, sy - py * shaftWidth / 2],
  ].map((p) => p.join(',')).join(' ');

  return (
    <svg
      width={boardSize}
      height={boardSize}
      viewBox={`0 0 ${boardSize} ${boardSize}`}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      <polygon
        points={shaftPoints}
        fill="#888"
        fillOpacity={0.5}
        stroke="rgba(0,0,0,0.2)"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
