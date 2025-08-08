import React, { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Chess, Move } from 'chess.js';
import { nanoid } from 'nanoid';
import { getSupabase } from '../lib/supabase';
import PiecePalette from '../components/PiecePalette';
import { pickBotMove } from '../lib/bot';

const Chessboard = dynamic(() => import('react-chessboard').then(m => m.Chessboard), { ssr: false });

type Mode = 'strict' | 'sandbox';
type PlayMode = 'none' | 'bot' | 'pass' | 'online';
type PosObj = Record<string, string>; // { e4: 'wP', ... }

const FILES = ['a','b','c','d','e','f','g','h'] as const;

function fileIndex(f: string) { return FILES.indexOf(f as any); }

// Auto-detect en passant target square per FEN spec:
// - Only set if an actual EP capture is possible
// - If multiple candidates exist, return "-" (ambiguous)
function autoDetectEnPassant(obj: PosObj, turn: 'w'|'b'): string {
  // If it's White to move, Black just moved (two-step) -> look for black pawn on rank 5, EP square on rank 6.
  // If it's Black to move, White just moved -> look for white pawn on rank 4, EP square on rank 3.
  const cands: string[] = [];

  if (turn === 'w') {
    // black just moved, scan black pawns on rank 5
    for (const f of FILES) {
      const sq = `${f}5`;
      if (obj[sq] !== 'bP') continue;
      const idx = fileIndex(f);
      const ep = `${f}6`;
      if (obj[ep]) continue; // must be empty
      // a white pawn on rank 5 adjacent can capture up to f6
      const left = idx > 0 ? `${FILES[idx-1]}5` : '';
      const right = idx < 7 ? `${FILES[idx+1]}5` : '';
      if ((left && obj[left] === 'wP') || (right && obj[right] === 'wP')) {
        cands.push(ep);
      }
    }
  } else {
    // turn === 'b' -> white just moved, scan white pawns on rank 4
    for (const f of FILES) {
      const sq = `${f}4`;
      if (obj[sq] !== 'wP') continue;
      const idx = fileIndex(f);
      const ep = `${f}3`;
      if (obj[ep]) continue;
      const left = idx > 0 ? `${FILES[idx-1]}4` : '';
      const right = idx < 7 ? `${FILES[idx+1]}4` : '';
      if ((left && obj[left] === 'bP') || (right && obj[right] === 'bP')) {
        cands.push(ep);
      }
    }
  }

  // exactly one legal capture → set it, else none
  return cands.length === 1 ? cands[0] : '-';
}

function posObjToFen(
  obj: PosObj,
  turn: 'w'|'b',
  castlingFlags: { K: boolean; Q: boolean; k: boolean; q: boolean; }
): { fen: string | null, error?: string } {
  // Build placement from rank 8 to 1
  let placement = '';
  let wK = 0, bK = 0;

  for (let r = 8; r >= 1; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const sq = `${FILES[f]}${r}`;
      const p = obj[sq];
      if (!p) { empty++; continue; }

      if (empty) { placement += String(empty); empty = 0; }

      // engine limitation: no pawns on rank 1/8
      if ((r === 1 || r === 8) && (p === 'wP' || p === 'bP')) {
        return { fen: null, error: `Pawns cannot be on rank ${r}. Promote them.` };
      }

      const map: Record<string,string> = {
        wK:'K', wQ:'Q', wR:'R', wB:'B', wN:'N', wP:'P',
        bK:'k', bQ:'q', bR:'r', bB:'b', bN:'n', bP:'p',
      };
      const sym = map[p];
      if (!sym) return { fen: null, error: `Unknown piece: ${p}` };
      if (sym === 'K') wK++;
      if (sym === 'k') bK++;
      placement += sym;
    }
    if (empty) placement += String(empty);
    if (r !== 1) placement += '/';
  }

  if (wK !== 1 || bK !== 1) {
    return { fen: null, error: `Place exactly one king per side (found W:${wK}, B:${bK}).` };
  }

  const castle =
    (castlingFlags.K ? 'K' : '') +
    (castlingFlags.Q ? 'Q' : '') +
    (castlingFlags.k ? 'k' : '') +
    (castlingFlags.q ? 'q' : '') || '-';

  const ep = autoDetectEnPassant(obj, turn); // '-' or square like 'e3' / 'd6'
  const fen = `${placement} ${turn} ${castle} ${ep} 0 1`;
  return { fen };
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('strict');
  const [playMode, setPlayMode] = useState<PlayMode>('none');

  // One unified FEN (both modes use chess.js for legality)
  const [fen, setFen] = useState<string>(new Chess().fen());
  const chessRef = useRef<Chess>(new Chess());

  // Editor state (sandbox)
  const [edit, setEdit] = useState(false);
  const [editPos, setEditPos] = useState<PosObj>({});
  const [editTurn, setEditTurn] = useState<'w'|'b'>('w');
  const [castleWK, setCastleWK] = useState(false);
  const [castleWQ, setCastleWQ] = useState(false);
  const [castleBK, setCastleBK] = useState(false);
  const [castleBQ, setCastleBQ] = useState(false);
  const [selectedPalette, setSelectedPalette] = useState<string | null>(null);

  const [status, setStatus] = useState<string>('');
  const [turn, setTurn] = useState<'w'|'b'>('w');

  const supabase = getSupabase();
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [myColor, setMyColor] = useState<'w'|'b'>('w');
  const channelRef = useRef<any>(null);

  // Keep chess.js in sync with FEN
  useEffect(() => {
    try {
      const c = new Chess(fen);
      chessRef.current = c;
      setTurn(c.turn());
      if (c.isGameOver()) {
        if (c.isCheckmate()) setStatus(`Checkmate. ${c.turn() === 'w' ? 'Black' : 'White'} wins.`);
        else if (c.isStalemate()) setStatus('Stalemate.');
        else setStatus('Game over.');
      } else setStatus('');
    } catch {
      setStatus('Invalid FEN.');
    }
  }, [fen]);

  function resetToStart() {
    const c = new Chess();
    chessRef.current = c;
    setFen(c.fen());
    setTurn('w');
    setStatus('');
    setEdit(false);
    setEditPos({});
    setSelectedPalette(null);
    setCastleWK(false); setCastleWQ(false); setCastleBK(false); setCastleBQ(false);
  }

  // I/O
  function exportFEN(): string { return fen; }
  function importFENText(text: string) {
    try {
      const c = new Chess(text);
      chessRef.current = c;
      setFen(text);
      setMode('strict');
    } catch { setStatus('Invalid FEN string.'); }
  }

  // Moves (legal & check rules enforced by chess.js)
  function onPieceDrop(source: string, target: string): boolean {
    if (edit) return false;
    const move = chessRef.current.move({ from: source, to: target, promotion: 'q' });
    if (!move) return false;
    const f = chessRef.current.fen();
    setFen(f);
    broadcastMove({ from: source, to: target, san: (move as Move).san!, fen: f });
    maybeBotMove();
    return true;
  }

  // Editor interactions
  function onSquareClick(square: string) {
    if (!edit) return;
    const next = { ...editPos };
    if (selectedPalette) next[square] = selectedPalette; else delete next[square];
    setEditPos(next);
  }

  function commitEdit() {
    const { fen: f, error } = posObjToFen(editPos, editTurn, {
      K: castleWK, Q: castleWQ, k: castleBK, q: castleBQ
    });
    if (!f) { setStatus(error || 'Could not build position.'); return; }
    try {
      const c = new Chess(f);
      chessRef.current = c;
      setFen(f);
      setMode('sandbox'); // user edited sandbox
      setEdit(false);
      setStatus('');
    } catch {
      setStatus('Position rejected by engine.');
    }
  }

  // Bot (works in strict & sandbox)
  function maybeBotMove() {
    if (playMode !== 'bot') return;
    const c = chessRef.current;
    const botColor: 'w'|'b' = myColor === 'w' ? 'b' : 'w';
    if (c.turn() !== botColor) return;
    const best = pickBotMove(c.fen(), botColor);
    if (!best) return;
    c.move(best);
    const f = c.fen();
    setFen(f);
    broadcastMove({ from: best.from!, to: best.to!, san: (best as Move).san!, fen: f });
  }

  // Realtime
  function createRoom() {
    if (!supabase) return;
    const id = nanoid(6);
    setRoomId(id);
    const ch = supabase.channel(`room:${id}`, { config: { broadcast: { ack: true }, presence: { key: nanoid() } } });
    channelRef.current = ch;
    ch.on('broadcast', { event: 'move' }, payload => {
      const { fen: rf } = (payload as any).payload || {};
      if (typeof rf !== 'string') return;
      try {
        const c = new Chess(rf);
        chessRef.current = c;
        setFen(rf);
      } catch {}
    });
    ch.subscribe((status: any) => {
      if (status === 'SUBSCRIBED') {
        setJoined(true);
        setMyColor('w');
      }
    });
  }

  async function joinRoom(id: string) {
    if (!supabase) return;
    setRoomId(id);
    const ch = supabase.channel(`room:${id}`, { config: { broadcast: { ack: true }, presence: { key: nanoid() } } });
    channelRef.current = ch;
    ch.on('broadcast', { event: 'move' }, payload => {
      const { fen: rf } = (payload as any).payload || {};
      if (typeof rf !== 'string') return;
      try {
        const c = new Chess(rf);
        chessRef.current = c;
        setFen(rf);
      } catch {}
    });
    await ch.subscribe((status: any) => {
      if (status === 'SUBSCRIBED') {
        setJoined(true);
        setMyColor('b');
      }
    });
  }

  function broadcastMove(move: { from: string, to: string, san: string, fen: string }) {
    if (!supabase || !channelRef.current) return;
    channelRef.current.send({ type: 'broadcast', event: 'move', payload: move });
  }

  const canUseRealtime = !!supabase;

  useEffect(() => { maybeBotMove(); /* eslint-disable-next-line */ }, [playMode, mode, myColor]);

  // Preview EP square while editing
  const previewEP = autoDetectEnPassant(editPos, editTurn);

  return (
    <div style={{ maxWidth: 1000, margin: '20px auto', padding: 16, fontFamily: 'Inter, system-ui, Arial' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>AnyChess</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Sandbox: legal moves + checks/mates; wild piece counts allowed. Castling toggles + auto en passant.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          <strong>Mode:</strong>{' '}
          <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
            <option value="strict">Strict (normal chess)</option>
            <option value="sandbox">Sandbox (custom setup)</option>
          </select>
        </label>
        <label>
          <strong>Play:</strong>{' '}
          <select value={playMode} onChange={e => setPlayMode(e.target.value as PlayMode)}>
            <option value="none">None</option>
            <option value="bot">Vs Bot</option>
            <option value="pass">Pass & Play</option>
            {canUseRealtime && <option value="online">Online (Supabase)</option>}
          </select>
        </label>
        <button onClick={() => setEdit(v => !v)}>{edit ? 'Cancel Edit' : 'Edit Board'}</button>
        {edit && <button onClick={commitEdit}>Apply Edit</button>}
        <button onClick={resetToStart}>Reset</button>
        <button onClick={() => navigator.clipboard.writeText(exportFEN())}>Copy FEN</button>
      </div>

      {edit && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Editor</h3>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <PiecePalette selected={selectedPalette} onSelect={setSelectedPalette} />
            <label>Turn: {' '}
              <select value={editTurn} onChange={e => setEditTurn(e.target.value as 'w'|'b')}>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 8 }}>
              <label><input type="checkbox" checked={castleWK} onChange={e=>setCastleWK(e.target.checked)} /> K (White O-O)</label>
              <label><input type="checkbox" checked={castleWQ} onChange={e=>setCastleWQ(e.target.checked)} /> Q (White O-O-O)</label>
              <label><input type="checkbox" checked={castleBK} onChange={e=>setCastleBK(e.target.checked)} /> k (Black O-O)</label>
              <label><input type="checkbox" checked={castleBQ} onChange={e=>setCastleBQ(e.target.checked)} /> q (Black O-O-O)</label>
            </div>
          </div>
          <p style={{ color: '#6b7280', marginTop: 8 }}>
            Auto EP: <b>{previewEP}</b>. (Set exactly one king per side. No pawns on ranks 1/8.)
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, marginTop: 16 }}>
        <div>
          <Chessboard
            id="board"
            position={fen}
            arePiecesDraggable={!edit}
            onPieceDrop={onPieceDrop}
            onSquareClick={onSquareClick}
            customBoardStyle={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            boardWidth={580}
          />
          <div style={{ marginTop: 8, color: status ? '#b91c1c' : '#444' }}>
            {status || `Turn: ${turn==='w'?'White':'Black'}`}
          </div>
        </div>

        <div>
          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Position I/O</h3>
            <textarea
              placeholder={'FEN here (strict or sandbox)'}
              style={{ width: '100%', minHeight: 80, fontFamily: 'monospace' }}
              defaultValue=""
              onBlur={(e) => e.target.value.trim() && importFENText(e.target.value.trim())}
            />
            <small style={{ color: '#555' }}>Paste a valid FEN and blur to import.</small>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Online Play</h3>
            {!canUseRealtime && (
              <p style={{ color: '#b45309' }}>
                Supabase env vars not set. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> & <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
              </p>
            )}
            {canUseRealtime && !joined && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={createRoom}>Create Room</button>
                <input placeholder="Room code" value={roomId} onChange={e=>setRoomId(e.target.value)} style={{ flex: 1 }} />
                <button onClick={()=>joinRoom(roomId)}>Join</button>
              </div>
            )}
            {canUseRealtime && joined && (
              <div>
                <p>You are <b>{myColor==='w'?'White':'Black'}</b>. Share code: <code>{roomId}</code></p>
                <p>Moves sync automatically.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
