# Zip

A mobile-first PWA clone of LinkedIn's Zip puzzle. Built for Jordann.

**Play:** https://gi-os.github.io/zip/

## Rules

Drag one continuous path that starts at **1**, passes through every number in order, and fills **every** square on the board. Thick black bars are walls you can't cross.

## Features

- Unlimited puzzles — every one procedurally generated with a guaranteed **unique** solution
- Three sizes: Easy (6×6, 8 numbers), Medium (6×6, 6 numbers), Hard (7×7, 7 numbers)
- Live timer, best time and solve count per difficulty (stored on device)
- Hints — rewinds to your last correct move and reveals the next square
- Undo / Clear / drag-back-to-erase
- Shareable puzzle links (`#medium-1280037693`) so two people can race the same board
- Installable PWA, works fully offline, no accounts, no server, no ads

## How the generator works

`engine.js` is dependency-free and DOM-free:

1. **Random Hamiltonian path** — start from a boustrophedon path over the grid, then run ~6000 *backbite* moves (pick an endpoint, jump to a random neighbor, reverse the tail). This yields a uniformly random path visiting every cell once.
2. **Checkpoints** — numbers are dropped at roughly evenly spaced positions along that path, always including both ends.
3. **Walls** — candidate edges that the solution never uses are added as walls.
4. **Uniqueness** — a backtracking solver counts solutions with two strong prunes: the unvisited region must stay connected to the cursor, and any unvisited cell with only one remaining connection must be the final number. Walls/numbers are added until exactly one solution exists.
5. **Minimize** — every wall and every interior number is then removed one at a time and kept out if the puzzle stays unique. That's what keeps boards clean (3–5 walls typically) instead of cluttered.

Generation is seeded (`mulberry32`), so a seed always reproduces the same board. Typical generation time is 3–16 ms.

## Local dev

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Service worker requires `https://` or `localhost`.

## Files

| File | Purpose |
|---|---|
| `engine.js` | Puzzle generation + uniqueness solver (no DOM) |
| `app.js` | Rendering, pointer/drag input, timer, hints, stats |
| `styles.css` | Light/dark theme, safe-area aware mobile layout |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | Install metadata |
