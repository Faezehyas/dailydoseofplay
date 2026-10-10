# Games backlog

What's live, what could come next, and how to claim a game so two people
don't build the same one. The recipe for building one is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Shipped

- **Sea Battle** (`sea-battle`): Battleship with gifts and special weapons. Hidden information, so it uses its own commit-and-audit protocol.
- **Tic Tac Toe** (`tic-tac-toe`): 3×3 with three in a row, or 5×5 with four; optional clocks; the room picks who starts. `TurnMatch`; minimax robot on 3×3, threat heuristic on 5×5.
- **Connect 4** (`connect-4`): 7×6 up to 9×9, discs drop into columns, four in a row; optional clocks; the room picks who starts. `TurnMatch`; alpha-beta robot with Easy, Medium and Hard levels.
- **Gomoku** (`gomoku`): 15×15, five or more in a row (an overline wins, as on papergames); optional clocks; the room picks who starts. `TurnMatch`; pattern-scoring robot.
- **Chess** (`chess`): FIDE rules with castling, en passant and promotion; automatic draws on stalemate, threefold repetition, the 50-move rule and insufficient material; optional clocks; resign. `TurnMatch`; alpha-beta robot with Easy, Medium and Hard levels.
- **Checkers** (`checkers`): 8×8 English draughts, mandatory captures, multi-jumps, kings, a draw after 40 turns with no capture or new king; optional clocks; the room picks who starts. `TurnMatch`, where a move is a full jump path; alpha-beta robot with Easy, Medium and Hard.
- **Backgammon** (`backgammon`): dice via `needsRandom` (a `{type: "roll"}` move drawn by both peers), bearing off, hitting, the bar; optional clocks; the room picks who starts; no cube or gammons. `TurnMatch`; play-scoring robot at three levels.
- **Chutes and Ladders** (`chutes-and-ladders`): the classic 1943 board (nine ladders, ten chutes) and a 1–6 spinner drawn by both peers; the room picks the finish rule (exact spin, bounce back or any spin), whether a 6 spins again, and who starts. `TurnMatch`; there are no choices, so the robot only spins. Two to four players, with friends or with 1–3 robots.
- **Dots and Boxes** (`dots-and-boxes`): 3×3 to 6×6 boxes; a line that closes a box (or two) earns another line; the most boxes wins and an even split draws; optional clocks per line and per player; the room picks who starts. `TurnMatch`; the robot's Hard level plays safe lines, counts chains and loops, and keeps control with the double-cross.
- **Ludo** (`ludo`): the cross-shaped board with four yards, a 52-square loop, star and start squares that are safe, and a home column per colour; a 6 brings a token out and rolls again, landing on a rival sends it home, and the centre needs an exact roll; the room picks house rules (three 6s lose the turn, blocks, a capture rolls again), whether to play on for places, who starts and a move timer. `TurnMatch` with a roll-then-pick turn like Backgammon; a position-scoring robot at three levels. Two to four players, with friends or with 1–3 robots.
- **Crazy Eights** (`crazy-eights`): 52 cards, 7 each for two players and 5 for three or four; follow the suit or the rank, 8s are wild and name a suit; draw until you can play (or draw one, then pass); the discard pile is reshuffled when the stock runs out; optional action cards (2 draw two, queen skip, ace reverse); the room picks who starts and a move timer. `CardMatch` (mental poker: no dealer, hidden hands, proved shuffles, an audit at the end); a robot at three levels that counts cards. Two to four players, with friends or with 1–3 robots.
- **Go Fish** (`go-fish`): 52 cards, 7 each for two or three players and 5 for four; ask a player for a rank you hold, take every card of it and go again, or go fish; a lucky fish goes again; four of a rank is a book; the most books wins, and players level share the win; room settings for the deal, the lucky fish, an empty hand (draw one or sit out), pairs instead of books, who starts and a time to ask. `CardMatch`, where an answer is a move of its own and cards change hands face up; robots at three levels, the hardest tracking every ask and answer. Two to four players, with friends or with 1–3 robots.
- **Gin Rummy** (`gin-rummy`): 52 cards, ten each, the deal alternating every hand; take the upcard or pass, then draw from the stock or the pile and discard; melds are sets and runs (aces low); knock with 10 or less of deadwood, gin with none; the defender lays off, an equal or lower deadwood undercuts for 25, gin scores 25; two cards left in the stock and no knock is a drawn hand; a game to 100 with a 100 game bonus and 25 a hand won, or one hand a game with the score adding up across rematches; Oklahoma knocking, Big Gin, who deals first and a move timer as room settings. `CardMatch`, one match a game, the deck shuffled again by both browsers before every hand; a knock shows the hand, so melds and scores are checked live; robots at three levels, the hardest counting every card that is gone.

## Up next

Candidates, in no particular order. Any of them is open to claim; so is a game
that isn't listed (propose it the same way).

| Game | Players | Protocol | Difficulty | Status |
|---|---|---|---|---|
| Reversi | 2 | TurnMatch | good first game | open |
| Mancala | 2 | TurnMatch | good first game | open |
| Hex | 2 | TurnMatch | good first game | open |
| Nine Men's Morris | 2 | TurnMatch | medium | open |
| Pass the Piece (the Quarto idea) | 2 | TurnMatch | medium | open |
| Pairs (the memory card game) | 2–4 | TurnMatch | medium | open |
| Rock Paper Scissors | 2 | hidden information, commit-and-reveal like Sea Battle | medium | open |
| Bulls and Cows (a hidden code) | 2 | hidden information, commit-and-reveal like Sea Battle | medium | open |
| Go 9×9 | 2 | TurnMatch | hard | open |
| Chinese Checkers | 2–4 | TurnMatch | hard | open |

Names: Othello, Quarto, Mastermind and Memory are trademarks, so the site uses
Reversi, Pass the Piece, Bulls and Cows and Pairs instead.

### What each one needs

What the engine has today: `TurnMatch` runs any game where everyone sees the
whole board and one seat moves at a time, with dice or other luck drawn by all
peers through `needsRandom`. `CardMatch` does the same for card games, with a
shared deck nobody deals and nobody can peek at. Rooms seat 2 to 4 players: the
server allows up to 8, but the seat colours stop at four. Other hidden
information, or moves made at the same time, need a match of their own, like
Sea Battle's `match.js`.

- **Reversi:** a player with no legal move passes; `rules.js` moves the turn on by itself. Nothing missing.
- **Mancala:** a sowing that ends in your own store keeps the turn, which `rules.js` decides. Nothing missing.
- **Hex:** an 11×11 rhombus (9×9 may suit a phone better), no draws, and an optional swap rule (the second player may take over the first stone), sent as a move. Nothing missing; a good robot needs a path-distance heuristic.
- **Nine Men's Morris:** placing, then moving, then flying with three pieces; a mill also removes a rival piece, so send one move such as `{ from, to, remove }`, the way Checkers sends a whole jump path. Needs its own draw rule for long games. Nothing missing.
- **Pass the Piece:** you place the piece your rival chose for you, then choose theirs: one move `{ cell, give }`. Sixteen pieces with four traits; four in a line sharing a trait wins. Nothing missing.
- **Pairs:** no one may know the face-down cards, and nothing needs to be hidden: draw a card's face from the faces not yet seen the first time it's turned (`needsRandom`), which gives the same odds as a shuffled deck. A pair keeps the turn. Two to four players, seated like Chutes and Ladders. Nothing missing.
- **Rock Paper Scissors:** both players choose at once, which `TurnMatch` can't do. Each round both send `commit()` from `engine/fair.js`, then both reveal and check with `verifyCommit()`; best of three or five. A small match of its own, much like Sea Battle's.
- **Bulls and Cows:** each player commits to a secret code at the start and answers the other's guesses with bulls and cows. At the end both reveal, and each audits every answer it got, as Sea Battle audits shots. A match of its own.
- **Go 9×9:** captures, passes, ko (keep past positions), area scoring after two passes, and a step where both agree on dead stones. `TurnMatch` covers it; the rules and a robot that answers in well under 100 ms are the hard part.
- **Chinese Checkers:** a six-pointed star; hops chain like Checkers jumps; two, three or four players from their own corners. Fitting the star at 360 px and a robot for four seats are the hard part. Six players would need two more seat colours and `maxPlayers` 6.

## Claim a game

1. **Propose it.** Open a [Game proposal](https://github.com/Faezehyas/dailydoseofplay/issues/new?template=game-proposal.yml) issue: the game, its players, a link to its rules, the protocol, a robot idea and how you'll make the art.
2. **Wait for the go-ahead.** A maintainer labels the issue `accepted`, assigns it to you and marks the game claimed here. Don't start a PR before that.
3. **Open a draft PR within a week.** If no draft PR links the issue a week after it's accepted, the claim lapses and the game is open again.
4. **One game per PR.** Engine changes the game needs can come first, in a PR of their own.

When a game ships, its PR moves it from "Up next" to "Shipped" and adds its
entry to `public/games.json`.
