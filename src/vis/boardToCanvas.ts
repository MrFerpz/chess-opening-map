// Draws a chess position onto a canvas context given a FEN string.
// Uses the same inline SVG piece paths as react-chessboard so the export
// matches what the user sees on screen — no external dependencies.

import type { Color } from '../types';

const LIGHT = '#f0d9b5';
const DARK  = '#b58863';

// Minimal FEN parser — returns a map of squareId → pieceCode (e.g. "wK", "bP")
function fenToPosition(fen: string): Record<string, string> {
  const pos: Record<string, string> = {};
  const ranks = fen.split(' ')[0].split('/');
  const files = 'abcdefgh';
  ranks.forEach((rank, ri) => {
    let fi = 0;
    for (const ch of rank) {
      if (/\d/.test(ch)) { fi += parseInt(ch); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toUpperCase();
      const square = files[fi] + (8 - ri);
      pos[square] = color + type;
      fi++;
    }
  });
  return pos;
}

// SVG path data for each piece — identical to react-chessboard's defaultPieces.
const PIECE_SVGS: Record<string, string> = {
  wP: `<path d="m 22.5,9 c -2.21,0 -4,1.79 -4,4 0,0.89 0.29,1.71 0.78,2.38 C 17.33,16.5 16,18.59 16,21 c 0,2.03 0.94,3.84 2.41,5.03 C 15.41,27.09 11,31.58 11,39.5 H 34 C 34,31.58 29.59,27.09 26.59,26.03 28.06,24.84 29,23.03 29,21 29,18.59 27.67,16.5 25.72,15.38 26.21,14.71 26.5,13.89 26.5,13 c 0,-2.21 -1.79,-4 -4,-4 z" style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round"/>`,
  wR: `<g style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z "/><path d="M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z "/><path d="M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14"/><path d="M 34,14 L 31,17 L 14,17 L 11,14"/><path d="M 31,17 L 31,29.5 L 14,29.5 L 14,17"/><path d="M 31,29.5 L 32.5,32 L 12.5,32 L 14,29.5"/><path d="M 11,14 L 34,14" style="fill:none"/></g>`,
  wN: `<g style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" style="fill:#ffffff;stroke:#000000"/><path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" style="fill:#ffffff;stroke:#000000"/><path d="M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z" style="fill:#000000;stroke:#000000"/><path d="M 15 15.5 A 0.5 1.5 0 1 1 14,15.5 A 0.5 1.5 0 1 1 15 15.5 z" transform="matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)" style="fill:#000000;stroke:#000000"/></g>`,
  wB: `<g style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><g style="fill:#ffffff;stroke:#000000;stroke-linecap:butt"><path d="M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.646,38.99 6.677,38.97 6,38 C 7.354,36.06 9,36 9,36 z"/><path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z"/><path d="M 25 8 A 2.5 2.5 0 1 1 20,8 A 2.5 2.5 0 1 1 25 8 z"/></g><path d="M 17.5,26 L 27.5,26 M 15,30 L 30,30 M 22.5,15.5 L 22.5,20.5 M 20,18 L 25,18" style="fill:none;stroke:#000000;stroke-linejoin:miter"/></g>`,
  wQ: `<g style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><circle cx="6" cy="12" r="2.75"/><circle cx="14" cy="9" r="2.75"/><circle cx="22.5" cy="8" r="2.75"/><circle cx="31" cy="9" r="2.75"/><circle cx="39" cy="12" r="2.75"/><path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 22.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" style="stroke-linecap:butt"/><path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11.5,38.5 11.5,38.5 C 17.5,39.5 27.5,39.5 33.5,38.5 C 33.5,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" style="stroke-linecap:butt"/><path d="M 11.5,30 C 15,29 30,29 33.5,30" style="fill:none"/><path d="M 12,33.5 C 18,32.5 27,32.5 33,33.5" style="fill:none"/></g>`,
  wK: `<g style="fill:#ffffff;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 22.5,11.63 L 22.5,6" style="fill:none;stroke:#000000;stroke-linejoin:miter"/><path d="M 20,8 L 25,8" style="fill:none;stroke:#000000;stroke-linejoin:miter"/><path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" style="fill:#ffffff;stroke:#000000;stroke-linecap:butt;stroke-linejoin:miter"/><path d="M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37" style="fill:#ffffff;stroke:#000000"/><path d="M 12.5,30 C 18,27 27,27 32.5,30" style="fill:none;stroke:#000000"/><path d="M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5" style="fill:none;stroke:#000000"/><path d="M 12.5,37 C 18,34 27,34 32.5,37" style="fill:none;stroke:#000000"/></g>`,
  bP: `<path d="m 22.5,9 c -2.21,0 -4,1.79 -4,4 0,0.89 0.29,1.71 0.78,2.38 C 17.33,16.5 16,18.59 16,21 c 0,2.03 0.94,3.84 2.41,5.03 C 15.41,27.09 11,31.58 11,39.5 H 34 C 34,31.58 29.59,27.09 26.59,26.03 28.06,24.84 29,23.03 29,21 29,18.59 27.67,16.5 25.72,15.38 26.21,14.71 26.5,13.89 26.5,13 c 0,-2.21 -1.79,-4 -4,-4 z" style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round"/>`,
  bR: `<g style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z " style="stroke-linecap:butt"/><path d="M 12.5,32 L 14,29.5 L 31,29.5 L 32.5,32 L 12.5,32 z " style="stroke-linecap:butt"/><path d="M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z " style="stroke-linecap:butt"/><path d="M 14,29.5 L 14,16.5 L 31,16.5 L 31,29.5 L 14,29.5 z " style="stroke-linecap:butt"/><path d="M 14,16.5 L 11,14 L 34,14 L 31,16.5 L 14,16.5 z " style="stroke-linecap:butt"/><path d="M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14 L 11,14 z " style="stroke-linecap:butt"/><path d="M 13,9 L 13,11 M 17,9 L 17,11 M 21,9 L 21,11 M 25,9 L 25,11 M 29,9 L 29,11 M 33,9 L 33,11" style="fill:none;stroke:#ffffff;stroke-width:1.5"/><path d="M 14,29.5 L 31,29.5" style="fill:none;stroke:#ffffff;stroke-width:1"/><path d="M 14,16.5 L 31,16.5" style="fill:none;stroke:#ffffff;stroke-width:1"/></g>`,
  bN: `<g style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" style="fill:#000000;stroke:#000000"/><path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" style="fill:#000000;stroke:#000000"/><path d="M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z" style="fill:#ababab;stroke:#ababab"/><path d="M 15 15.5 A 0.5 1.5 0 1 1 14,15.5 A 0.5 1.5 0 1 1 15 15.5 z" transform="matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)" style="fill:#ababab;stroke:#ababab"/></g>`,
  bB: `<g style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><g style="fill:#000000;stroke:#000000;stroke-linecap:butt"><path d="M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.646,38.99 6.677,38.97 6,38 C 7.354,36.06 9,36 9,36 z"/><path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z"/><path d="M 25 8 A 2.5 2.5 0 1 1 20,8 A 2.5 2.5 0 1 1 25 8 z"/></g><path d="M 17.5,26 L 27.5,26 M 15,30 L 30,30 M 22.5,15.5 L 22.5,20.5 M 20,18 L 25,18" style="fill:none;stroke:#ababab;stroke-linejoin:miter"/></g>`,
  bQ: `<g style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><circle cx="6" cy="12" r="2.75"/><circle cx="14" cy="9" r="2.75"/><circle cx="22.5" cy="8" r="2.75"/><circle cx="31" cy="9" r="2.75"/><circle cx="39" cy="12" r="2.75"/><path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 22.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" style="stroke-linecap:butt"/><path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11.5,38.5 11.5,38.5 C 17.5,39.5 27.5,39.5 33.5,38.5 C 33.5,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" style="stroke-linecap:butt"/><path d="M 11.5,30 C 15,29 30,29 33.5,30" style="fill:none"/><path d="M 12,33.5 C 18,32.5 27,32.5 33,33.5" style="fill:none"/></g>`,
  bK: `<g style="fill:#000000;stroke:#000000;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M 22.5,11.63 L 22.5,6" style="fill:none;stroke:#000000;stroke-linejoin:miter"/><path d="M 20,8 L 25,8" style="fill:none;stroke:#000000;stroke-linejoin:miter"/><path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" style="fill:#000000;stroke:#000000;stroke-linecap:butt;stroke-linejoin:miter"/><path d="M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37" style="fill:#000000;stroke:#000000"/><path d="M 12.5,30 C 18,27 27,27 32.5,30" style="fill:none;stroke:#ababab"/><path d="M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5" style="fill:none;stroke:#ababab"/><path d="M 12.5,37 C 18,34 27,34 32.5,37" style="fill:none;stroke:#ababab"/></g>`,
};

// Draws the board at (offsetX, offsetY) with the given pixel size.
export async function drawBoardOnCanvas(
  ctx: CanvasRenderingContext2D,
  fen: string,
  orientation: Color,
  boardSize: number,
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const sq = boardSize / 8;
  const files = 'abcdefgh';
  const position = fenToPosition(fen);

  // Draw squares
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      ctx.fillStyle = isLight ? LIGHT : DARK;
      ctx.fillRect(offsetX + f * sq, offsetY + r * sq, sq, sq);
    }
  }

  // Draw pieces
  const piecePromises: Promise<void>[] = [];
  for (const [square, piece] of Object.entries(position)) {
    const fileIndex = files.indexOf(square[0]);
    const rankIndex = 8 - parseInt(square[1]);
    const [col, row] = orientation === 'white'
      ? [fileIndex, rankIndex]
      : [7 - fileIndex, 7 - rankIndex];

    const svgBody = PIECE_SVGS[piece];
    if (!svgBody) continue;

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" width="${sq}" height="${sq}">${svgBody}</svg>`;
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const px = offsetX + col * sq;
    const py = offsetY + row * sq;

    piecePromises.push(new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, px, py, sq, sq);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    }));
  }

  await Promise.all(piecePromises);
}
