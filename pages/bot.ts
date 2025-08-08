import { Chess, Move } from 'chess.js';

// Piece values (centipawns)
const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function materialScore(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      const s = VAL[cell.type];
      score += cell.color === 'w' ? s : -s;
    }
  }
  return score;
}

// Very simple: pick the legal move that maximizes immediate material gain; tie-break randomly.
export function pickBotMove(fen: string, color: 'w' | 'b'): Move | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];

  if (moves.length === 0) return null;

  // shuffle for tie-break randomness
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }

  let best: Move | null = null;
  let bestScore = -1e9;

  const base = materialScore(chess);
  for (const m of moves) {
    chess.move(m);
    const score = materialScore(chess) * (color === 'w' ? 1 : -1);
    chess.undo();
    const delta = score - base * (color === 'w' ? 1 : -1);
    if (delta > bestScore) {
      bestScore = delta;
      best = m;
    }
  }
  return best;
}