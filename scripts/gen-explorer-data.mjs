// Pre-aggregate Lichess monthly DB dumps into static per-band opening trees.
//
// Streams .pgn.zst dumps (from URL), filters games by rating band + speed,
// aggregates openings into a SerializedNode-shaped tree per band, prunes by
// minCount, strips FEN (recomputed client-side), and writes
// public/explorer/<band>-<speeds>.json.
//
// Single pass, "take what's available": streams ONE month (--month). Each band
// collects up to --per-band games; once every band is full the stream is killed
// (lower/middle bands fill in seconds). Sparse top bands (2200+, 2400+) simply
// take whatever that month contains — no chasing 100k across months. If you ever
// want to top up a sparse band from earlier months, bump --max-months > 1 and it
// will walk backwards collecting ONLY bands still below target.
//
// Usage (one run generates everything):
//   node scripts/gen-explorer-data.mjs \
//     --month 2026-03 --bands 1000,1200,1400,1600,1800,2000,2200,2400 \
//     --speeds blitz,rapid --per-band 100000 --min-count 15 --depth 14
//
// This is a build-time tool; it is not shipped or imported by the app.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Chess } from 'chess.js';

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const START_MONTH = args.month ?? '2026-03';
const BANDS = (args.bands ?? '1000,1200,1400,1600,1800,2000,2200,2400').split(',').map(Number);
const SPEEDS = (args.speeds ?? 'blitz,rapid').split(',');
const PER_BAND = Number(args['per-band'] ?? 100000);
const MIN_COUNT = Number(args['min-count'] ?? 15);
const DEPTH = Number(args.depth ?? 14);
const MAX_MONTHS = Number(args['max-months'] ?? 1);
const OUT_DIR = 'public/explorer';

const URL_FOR = (m) =>
  `https://database.lichess.org/standard/lichess_db_standard_rated_${m}.pgn.zst`;

function prevMonth(ym) {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ── classification ────────────────────────────────────────────────────────────
function speedFromTC(tc) {
  if (!tc || tc === '-') return 'classical';
  const [base, inc] = tc.split('+').map((n) => parseInt(n, 10) || 0);
  const est = base + 40 * inc;
  if (est < 179) return 'bullet'; // ultraBullet + bullet
  if (est < 479) return 'blitz';
  if (est < 1499) return 'rapid';
  return 'classical';
}

function bandFor(elo) {
  if (elo < 1000) return null;
  if (elo >= 2400) return 2400;
  return Math.floor(elo / 200) * 200;
}

// ── tree ──────────────────────────────────────────────────────────────────────
function node(san, ply) {
  return { san, ply, count: 0, white: 0, draws: 0, black: 0, ratingSum: 0, children: new Map() };
}
const trees = new Map();
const counts = new Map();
for (const b of BANDS) { trees.set(b, node(null, 0)); counts.set(b, 0); }

function recordGame(band, sans, result, avg) {
  const root = trees.get(band);
  const w = result === '1-0' ? 1 : 0;
  const d = result === '1/2-1/2' ? 1 : 0;
  const bl = result === '0-1' ? 1 : 0;
  root.count++; root.white += w; root.draws += d; root.black += bl; root.ratingSum += avg;
  let cur = root;
  const end = Math.min(sans.length, DEPTH);
  for (let i = 0; i < end; i++) {
    const san = sans[i];
    let child = cur.children.get(san);
    if (!child) { child = node(san, i + 1); cur.children.set(san, child); }
    child.count++; child.white += w; child.draws += d; child.black += bl; child.ratingSum += avg;
    cur = child;
  }
}

// ── PGN streaming parser ──────────────────────────────────────────────────────
let cur = { headers: {}, moves: '' };
let inMoves = false;
let totalScanned = 0;

function openBands() {
  return BANDS.filter((b) => counts.get(b) < PER_BAND);
}

function finishGame() {
  totalScanned++;
  const h = cur.headers;
  const we = parseInt(h.WhiteElo, 10);
  const be = parseInt(h.BlackElo, 10);
  if (Number.isFinite(we) && Number.isFinite(be)) {
    const avg = (we + be) / 2;
    const band = bandFor(avg);
    if (band != null && trees.has(band) && counts.get(band) < PER_BAND) {
      if (SPEEDS.includes(speedFromTC(h.TimeControl))) {
        const sans = parseMoves(cur.moves);
        if (sans.length > 0) {
          recordGame(band, sans, h.Result, avg);
          counts.set(band, counts.get(band) + 1);
        }
      }
    }
  }
  cur = { headers: {}, moves: '' };
  inMoves = false;
}

function parseMoves(movetext) {
  return movetext
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function feedLine(line) {
  if (line.startsWith('[')) {
    if (inMoves) finishGame();
    const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
    if (m) cur.headers[m[1]] = m[2];
  } else if (line.trim() === '') {
    if (cur.moves) inMoves = true;
  } else {
    inMoves = true;
    cur.moves += ' ' + line;
  }
}

// ── stream one month; resolves when all open bands fill or file ends ──────────
function streamMonth(month) {
  return new Promise((resolve) => {
    const curl = spawn('curl', ['-sL', URL_FOR(month)]);
    const z = spawn('zstd', ['-dc']);
    curl.stdout.pipe(z.stdin);
    curl.stderr.on('data', () => {});
    z.stderr.on('data', () => {});

    let buf = '';
    let bytes = 0;
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      try { curl.kill('SIGKILL'); } catch {}
      try { z.kill('SIGKILL'); } catch {}
      resolve({ reason, mb: bytes / 1e6 });
    };

    z.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      buf += chunk.toString('latin1');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        feedLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (openBands().length === 0) finish('all bands full');
    });
    z.on('close', () => { if (inMoves) finishGame(); finish('file ended'); });
    curl.on('error', () => finish('curl error'));
  });
}

// ── serialize: prune + strip FEN ──────────────────────────────────────────────
function serialize(n) {
  const children = [];
  for (const c of n.children.values()) {
    if (c.count >= MIN_COUNT) children.push(serialize(c));
  }
  children.sort((a, b) => b.count - a.count);
  return {
    san: n.san,
    ply: n.ply,
    count: n.count,
    wins: n.white,
    draws: n.draws,
    losses: n.black,
    avgRating: Math.round(n.ratingSum / Math.max(1, n.count)),
    children,
  };
}
function countNodes(n) {
  let c = 1;
  for (const ch of n.children) c += countNodes(ch);
  return c;
}

// ── run ──────────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
console.log(`bands=${BANDS.join(',')} speeds=${SPEEDS.join(',')} per-band=${PER_BAND} minCount=${MIN_COUNT} depth=${DEPTH} maxMonths=${MAX_MONTHS}`);

const t0 = Date.now();
let month = START_MONTH;
for (let i = 0; i < MAX_MONTHS; i++) {
  const open = openBands();
  if (open.length === 0) break;
  console.log(`\n[month ${month}] streaming; open bands: ${open.join(',')}`);
  const { reason, mb } = await streamMonth(month);
  console.log(`  ${reason} after ~${mb.toFixed(0)} MB; counts: ${BANDS.map((b) => `${b}:${counts.get(b)}`).join(' ')}`);
  if (reason === 'curl error') break;
  month = prevMonth(month);
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\nScanned ${totalScanned.toLocaleString()} games in ${secs}s. Writing trees...\n`);

const speedTag = SPEEDS.join('-');
let totalGz = 0;
for (const b of BANDS) {
  const root = serialize(trees.get(b));
  const path = `${OUT_DIR}/${b}-${speedTag}.json`;
  const json = JSON.stringify(root);
  writeFileSync(path, json);
  const gz = gzipSync(Buffer.from(json));
  totalGz += gz.length;
  console.log(
    `band ${b}: ${counts.get(b).toLocaleString().padStart(7)} games | ${String(countNodes(root)).padStart(6)} nodes | ` +
    `raw ${(json.length / 1e6).toFixed(2)} MB | gzip ${(gz.length / 1e3).toFixed(0)} KB`,
  );
}
console.log(`\nTotal shipped (gzipped, all bands): ${(totalGz / 1e3).toFixed(0)} KB`);

void Chess;
process.exit(0);
