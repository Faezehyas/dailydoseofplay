# Games backlog

The order follows papergames.io's lineup. Build them top to bottom; the recipe
is in `CONTRIBUTING.md`. Each game's slug is already in `public/games.json` with
`"status": "soon"`.

- [x] **Sea Battle** (`sea-battle`): Battleship with gifts and special weapons. Hidden information, so it uses its own commit-and-audit protocol.
- [x] **Tic Tac Toe** (`tic-tac-toe`): 3×3 with three in a row, or 5×5 with four; optional clocks; the room picks who starts. `TurnMatch`; minimax robot on 3×3, threat heuristic on 5×5.
- [x] **Connect 4** (`connect-4`): 7×6 up to 9×9, discs drop into columns, four in a row; optional clocks; the room picks who starts. `TurnMatch`; alpha-beta robot with Easy, Medium and Hard levels.
- [x] **Gomoku** (`gomoku`): 15×15, five or more in a row (an overline wins, as on papergames); optional clocks; the room picks who starts. `TurnMatch`; pattern-scoring robot.
- [x] **Chess** (`chess`): FIDE rules with castling, en passant and promotion; automatic draws on stalemate, threefold repetition, the 50-move rule and insufficient material; optional clocks; resign. `TurnMatch`; alpha-beta robot with Easy, Medium and Hard levels.
- [x] **Checkers** (`checkers`): 8×8 English draughts, mandatory captures, multi-jumps, kings, a draw after 40 turns with no capture or new king; optional clocks; the room picks who starts. `TurnMatch`, where a move is a full jump path; alpha-beta robot with Easy, Medium and Hard.
- [x] **Backgammon** (`backgammon`): dice via `needsRandom` (a `{type: "roll"}` move drawn by both peers), bearing off, hitting, the bar; optional clocks; the room picks who starts; no cube or gammons. `TurnMatch`; play-scoring robot at three levels.

When a game ships, tick it here and set its `games.json` status to `ready`.
