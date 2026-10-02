# Games backlog

The order follows papergames.io's lineup. Build them top to bottom; the recipe
is in `CONTRIBUTING.md`. Each game's slug is already in `public/games.json` with
`"status": "soon"`.

- [x] **Sea Battle** (`sea-battle`): Battleship with gifts and special weapons. Hidden information, so it uses its own commit-and-audit protocol.
- [x] **Tic Tac Toe** (`tic-tac-toe`): 3×3, three in a row. `TurnMatch`; a minimax robot is trivial.
- [ ] **Connect 4** (`connect-4`): 7×6, discs drop into columns, four in a row. `TurnMatch`; shallow minimax with a threat heuristic.
- [ ] **Gomoku** (`gomoku`): 15×15, exactly five in a row. `TurnMatch`; pattern-scoring robot.
- [ ] **Chess** (`chess`): standard rules, including castling, en passant, promotion, and stalemate and repetition draws. `TurnMatch`; small alpha-beta robot.
- [ ] **Checkers** (`checkers`): 8×8, mandatory captures, multi-jumps, kings. `TurnMatch`, where a move is a full jump path.
- [ ] **Backgammon** (`backgammon`): dice via `needsRandom` (a `{type: "roll"}` move drawn by both peers), bearing off, hitting, the bar. `TurnMatch`.

When a game ships, tick it here and set its `games.json` status to `ready`.
