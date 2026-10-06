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
- [x] **Chutes and Ladders** (`chutes-and-ladders`): the classic 1943 board (nine ladders, ten chutes) and a 1–6 spinner drawn by both peers; the room picks the finish rule (exact spin, bounce back or any spin), whether a 6 spins again, and who starts. `TurnMatch`; there are no choices, so the robot only spins. Two to four players, with friends or with 1–3 robots.
- [x] **Dots and Boxes** (`dots-and-boxes`): 3×3 to 6×6 boxes; a line that closes a box (or two) earns another line; the most boxes wins and an even split draws; optional clocks per line and per player; the room picks who starts. `TurnMatch`; the robot's Hard level plays safe lines, counts chains and loops, and keeps control with the double-cross.
- [x] **Ludo** (`ludo`): the cross-shaped board with four yards, a 52-square loop, star and start squares that are safe, and a home column per colour; a 6 brings a token out and rolls again, landing on a rival sends it home, and the centre needs an exact roll; the room picks house rules (three 6s lose the turn, blocks, a capture rolls again), whether to play on for places, who starts and a move timer. `TurnMatch` with a roll-then-pick turn like Backgammon; a position-scoring robot at three levels. Two to four players, with friends or with 1–3 robots.

When a game ships, tick it here and set its `games.json` status to `ready`.
