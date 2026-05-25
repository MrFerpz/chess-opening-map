import { Chessboard } from 'react-chessboard';
import type { Color } from '../types';
import { MoveArrow, BestMoveArrow } from './MoveArrow';

interface Props {
  fen: string;
  size: number;
  containerSize: number;
  orientation: Color;
  hoverSan?: string | null;
  hoverFromFen?: string;
  bestMoveUci?: string | null;  // UCI best move for the focus position e.g. "e2e4"
}

export function CenterBoard({ fen, size, containerSize, orientation, hoverSan, hoverFromFen, bestMoveUci }: Props) {
  const pct = ((size / containerSize) * 100).toFixed(4) + '%';
  return (
    <div
      data-board-wrapper=""
      style={{
        width: pct,
        height: pct,
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          showNotation: false,
          boardOrientation: orientation,
          animationDurationInMs: 200,
          id: 'center-board',
        }}
      />
      {hoverSan && hoverFromFen && (
        <MoveArrow
          fromFen={hoverFromFen}
          san={hoverSan}
          boardSize={size}
          orientation={orientation}
        />
      )}
      {!hoverSan && bestMoveUci && (
        <BestMoveArrow
          uci={bestMoveUci}
          boardSize={size}
          orientation={orientation}
        />
      )}
    </div>
  );
}
