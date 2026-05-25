/**
 * Generates public/loading-chess.gif — an animated chess board showing the
 * Immortal Game (Anderssen vs Kieseritzky, 1851) as a looping GIF.
 * Run once: node scripts/gen-loading-gif.mjs
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../public/loading-chess.gif');

const SIZE = 128;        // GIF size in px
const SQUARE = SIZE / 8;
const FRAME_DELAY = 80; // centiseconds per frame (800ms — slower so fewer frames needed)
const PAUSE_FRAMES = 2; // extra frames held at end position
const MOVE_STRIDE = 2;  // encode every Nth move (skip frames to keep file small)

// Immortal Game moves
const MOVES = [
  'e4','e5','f4','exf4','Bc4','Qh4+','Kf1','b5','Bxb5','Nf6','Nf3','Qh6',
  'd3','Nh5','Nh4','Qg5','Nf5','c6','g4','Nf6','Rg1','cxb5','h4','Qg6',
  'h5','Qg5','Qf3','Ng8','Bxf4','Qf6','Nc3','Bc5','Nd5','Qxb2','Bd6',
  'Bxg1','e5','Qxa1+','Ke2','Na6','Nxg7+','Kd8','Qf6+','Nxf6','Be7#',
];

// Colour palette
const LIGHT = '#f0d9b5';
const DARK  = '#b58863';
const BG    = '#0d0f16';

// Unicode chess pieces mapped from FEN piece codes
const PIECE_GLYPH = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

function parseFen(fen) {
  const board = Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, rank) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += parseInt(ch); }
      else { board[rank * 8 + file] = ch; file++; }
    }
  });
  return board;
}

function renderFrame(fen) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const board = parseFen(fen);

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const x = file * SQUARE;
      const y = rank * SQUARE;
      const light = (rank + file) % 2 === 0;
      ctx.fillStyle = light ? LIGHT : DARK;
      ctx.fillRect(x, y, SQUARE, SQUARE);

      const piece = board[rank * 8 + file];
      if (piece) {
        const glyph = PIECE_GLYPH[piece];
        if (glyph) {
          const isWhite = piece === piece.toUpperCase();
          ctx.fillStyle = isWhite ? '#fff' : '#111';
          ctx.font = `bold ${Math.round(SQUARE * 0.75)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Thin shadow for visibility on both square colours
          ctx.shadowColor = isWhite ? '#0008' : '#fff8';
          ctx.shadowBlur = 2;
          ctx.fillText(glyph, x + SQUARE / 2, y + SQUARE / 2 + 1);
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function encodeFrame(encoder, rgba, delay = FRAME_DELAY) {
  const palette = quantize(rgba, 64, { format: 'rgb565' });
  const indexed = applyPalette(rgba, palette);
  encoder.writeFrame(indexed, SIZE, SIZE, { palette, delay });
}

console.log('Generating loading-chess.gif…');

const chess = new Chess();
const encoder = GIFEncoder();
encoder.writeHeader();

// Opening static frame (starting position)
encodeFrame(encoder, renderFrame(chess.fen()));

let moveCount = 0;
for (const move of MOVES) {
  try { chess.move(move); } catch { continue; }
  moveCount++;
  if (moveCount % MOVE_STRIDE === 0) {
    encodeFrame(encoder, renderFrame(chess.fen()));
  }
}

// Hold final position for a moment
const finalRgba = renderFrame(chess.fen());
for (let i = 0; i < PAUSE_FRAMES; i++) {
  encodeFrame(encoder, finalRgba, FRAME_DELAY * 3);
}

encoder.finish();

const buffer = Buffer.from(encoder.bytes());
writeFileSync(OUT, buffer);
console.log(`Written ${buffer.length} bytes → ${OUT}`);
