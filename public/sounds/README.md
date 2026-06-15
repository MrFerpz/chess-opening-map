# Move sounds

The app plays a sound on each move, chosen from the move's SAN (see
`src/lib/sounds.ts`). Drop these seven `.mp3` files into this folder:

| File             | Played when                                  |
|------------------|----------------------------------------------|
| `move.mp3`       | a normal move                                |
| `capture.mp3`    | a capture (`x` in SAN)                        |
| `check.mp3`      | a check (`+` in SAN)                          |
| `castle.mp3`     | castling (`O-O` / `O-O-O`)                    |
| `promote.mp3`    | a promotion (`=` in SAN)                      |
| `navigate.mp3`   | zooming out / stepping back in the sunburst   |
| `end.mp3`        | checkmate (`#` in SAN)                        |

If a file is missing, playback fails silently — no crash.

## Sources

A mix of Lichess and Chess.com default sounds. Lichess's `standard` set commits
`Check.mp3` and `Castles.mp3` as symlinks to `Silence.mp3` (Lichess plays no
distinct check/castle sound), so those — plus promotion — use Chess.com's real
clips instead, giving every move type its own sound.

| Local file     | Source                                                              |
|----------------|--------------------------------------------------------------------|
| `move.mp3`     | Lichess `standard/Move.mp3`                                         |
| `capture.mp3`  | Lichess `standard/Capture.mp3`                                      |
| `check.mp3`    | Chess.com `default/move-check.mp3`                                  |
| `castle.mp3`   | Chess.com `default/castle.mp3`                                      |
| `promote.mp3`  | Chess.com `default/promote.mp3`                                     |
| `navigate.mp3` | Lichess `standard/GenericNotify.mp3`                                |
| `end.mp3`      | Lichess `sfx/Victory.mp3`                                           |

Lichess: github.com/lichess-org/lila under `public/sound/`.
Chess.com: `images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/`.
