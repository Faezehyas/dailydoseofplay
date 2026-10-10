// Chess's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Win by **checkmate**: attack the other king so that no move can save it.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: "Each side starts with 16 pieces: eight pawns, two rooks, two knights, two bishops, a queen and a king. White moves first, then turns alternate.",
  turn: [
    "Move one piece: tap it to see where it can go, then tap a highlighted square. Your own move may never leave your king under attack.",
    "The king steps one square any way. The queen slides any distance straight or diagonally, rooks slide straight, and bishops slide diagonally. Knights jump in an L and may hop over pieces. Pawns walk one square forward (two from their starting row) and capture one square diagonally forward.",
    "**Castling:** if your king and a rook haven't moved, the squares between them are empty, and the king is not in check and doesn't cross or land on an attacked square, move the king two squares toward the rook; the rook jumps to its other side. Tap the king, then its destination.",
    "**En passant:** when a pawn steps two squares and lands beside one of your pawns, you may take it as if it had moved one square, but only on your very next move.",
    "**Promotion:** a pawn reaching the far row becomes a queen, rook, bishop or knight of your choice.",
    "You can also **resign** on your turn.",
  ],
  winning: [
    "Checkmate wins. Whoever runs out of time loses.",
    "**Draws** happen on their own: stalemate (no legal move, but not in check), the same position three times, fifty moves each without a capture or a pawn move, or too few pieces left for anyone to checkmate.",
    "**Rematch** starts another game with the same settings.",
  ],
  settings: [
    "Clocks: a limit per move and a total per player, or none.",
    "Who plays White: a coin toss drawn by both browsers, you, or your opponent.",
    "Robot level: Easy, Medium or Hard.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, so a move that breaks them stops the match. Each browser keeps its own player's clock.",
  keyboard: "Move with the arrow keys; press Enter or Space to pick up and put down a piece.",
};
