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
type PosObj = Record<string, string>;

export default function Home() {
  const [mode, setMode] = useState<Mode>('strict');
  const [playMode, setPlayMode] = useState<PlayMode>('none');
  const [edit, setEdit] = useState(false);
  const [fen, setFen] = useState<string>(new Chess().fen());
  const [sandboxPos, setSandboxPos] = useState<PosObj>({});
  const [turn, setTurn] = useState<'w'|'b'>('w');
  const [selectedPalette, setSelectedPalette] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const chessRef = useRef<Chess>(new Chess());
  const [roomId, setRoomId] = useState<string>('');
  const [joined, setJoined] = useState<boolean>(false);
  const [myColor, setMyColor] = useState<'w'|'b'>('w');

  useEffect(() => {
    if (mode !== 'strict') return;
    const c = new Chess();
    try {
      c.load(fen);
      chessRef.current = c;
      setTurn(c.turn());
      if (c.isGameOver()) {
        if (c.isCheckmate()) setStatus(`Checkmate. ${c.turn() === 'w' ? 'Black' : 'White'} wins.`);
        else if (c.isStalemate()) setStatus('Stalemate.');
        else setStatus('Game over.');
      } else setStatus('');
    } catch {
      setStatus('Invalid FEN for strict mode.');
    }
  }, [fen, mode]);

  function resetToStart() {
    if (mode === 'strict') {
      const c = new Chess();
      chessRef.current = c;
      setFen(c.fen());
      setTurn('w');
    } else {
      setSandboxPos({});
      setTurn('w');
    }
    setStatus('');
  }

  function exportFEN(): string {
    if (mode === 'strict') return fen;
    const pieces = Object.entries(sandboxPos).map(([sq, p]) => p+':'+sq).join(',');
    return `SANDBOX:${turn}:${pieces}`;
  }

  function importFENText(text: string) {
    if (text.startsWith('SANDBOX:')) {
      const parts = text.split(':'); // SANDBOX:turn:pieces
      const t = parts[1] === 'b' ? 'b' : 'w';
      const rest = parts.slice(2).join(':');
      const obj: PosObj = {};
      if (rest.trim()) {
        for (const chunk of rest.split(',')) {
          const [piece, sq] = chunk.split(':');
          if (piece && sq) obj[sq] = piece;
        }
      }
      setMode('sandbox');
      setSandboxPos(obj);
      setTurn(t);
    } else {
      setMode('strict');
      setFen(text);
    }
  }

  function onPieceDropStrict(source: string, target: string): boolean {
    const move = chessRef.current.move({ from: source, to: target, promotion: 'q' });
    if (!move) return false;
    setFen(chessRef.current.fen());
    setTurn(chessRef.current.turn());
    broadcastMove({ from: source, to: target, san: move.san, fen: chessRef.current.fen() });
    maybeBotMove();
    return true;
  }

  function onPieceDropSandbox(source: string, target: string): boolean {
    const next = { ...sandboxPos };
    const piece = next[source];
    if (!piece) return false;
    next[target] = piece;
    delete next[source];
    setSandboxPos(next);
    setTurn(turn === 'w' ? 'b' : 'w');
    broadcastMove({ from: source, to: target, san: `${piece}:${source}-${target}`, fen: exportFEN() });
    return true;
  }

  function onSquareClick(square: string) {
    if (!edit) return;
    if (mode === 'sandbox') {
      const next = { ...sandboxPos };
      if (selectedPalette) next[square] = selectedPalette; else delete next[square];
      setSandboxPos(next);
    } else {
      const next = { ...sandboxPos };
      if (selectedPalette) next[square] = selectedPalette; else delete next[square];
      setSandboxPos(next);
      setMode('sandbox');
    }
  }

  function maybeBotMove() {
    if (mode !== 'strict' || playMode !== 'bot') return;
    const c = chessRef.current;
    const botColor: 'w'|'b' = myColor === 'w' ? 'b' : 'w';
    if (c.turn() !== botColor) return;
    const best = pickBotMove(c.fen(), botColor);
    if (!best) return;
    c.move(best);
    setFen(c.fen());
    setTurn(c.turn());
    broadcastMove({ from: best.from!, to: best.to!, san: best.san!, fen: c.fen() });
  }

  const channelRef = useRef<any>(null);

  function createRoom() {
    const supabase = getSupabase();
    if (!supabase) return;
    const id = nanoid(6);
    setRoomId(id);
    const ch = supabase.channel(`room:${id}`, { config: { broadcast: { ack: true }, presence: { key: nanoid() } } });
    channelRef.current = ch;
    ch.on('broadcast', { event: 'move' }, payload => {
      const { fen: rf } = (payload as any).payload || {};
      if (typeof rf !== 'string') return;
      if (rf.startsWith('SANDBOX:')) return importFENText(rf);
      try {
        const c = new Chess(rf);
        chessRef.current = c;
        setFen(rf);
        setTurn(c.turn());
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
    const supabase = getSupabase();
    if (!supabase) return;
    setRoomId(id);
    const ch = supabase.channel(`room:${id}`, { config: { broadcast: { ack: true }, presence: { key: nanoid() } } });
    channelRef.current = ch;
    ch.on('broadcast', { event: 'move' }, payload => {
      const { fen: rf } = (payload as any).payload || {};
      if (typeof rf !== 'string') return;
      if (rf.startsWith('SANDBOX:')) return importFENText(rf);
      try {
        const c = new Chess(rf);
        chessRef.current = c;
        setFen(rf);
        setTurn(c.turn());
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
    const supabase = getSupabase();
    if (!supabase || !channelRef.current) return;
    channelRef.current.send({ type: 'broadcast', event: 'move', payload: move });
  }

  const canUseRealtime = !!getSupabase();

  useEffect(() => {
    maybeBotMove();
  }, [playMode, mode, myColor]);

  return (
    <div style={{ maxWidth: 1000, margin: '20px auto', padding: 16, fontFamily: 'Inter, system-ui, Arial' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>AnyChess</h1>
      <p style={{ marginTop: 0, color: '#555' }}>Set up any position (even invalid) and play vs bot, pass-and-play, or online.</p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          <strong>Mode:</strong>{' '}
          <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
            <option value="strict">Strict (real chess)</option>
            <option value="sandbox">Sandbox (god mode)</option>
          </select>
        </label>
        <label>
          <strong>Play:</strong>{' '}
          <select value={playMode} onChange={e => setPlayMode(e.target.value as PlayMode)}>
            <option value="none">None (analysis)</option>
            <option value="bot">Vs Bot (strict only)</option>
            <option value="pass">Pass & Play (local)</option>
            {canUseRealtime && <option value="online">Online (Supabase)</option>}
          </select>
        </label>
        <button onClick={() => setEdit(v => !v)}>{edit ? 'Done Editing' : 'Edit Board'}</button>
        <button onClick={resetToStart}>Reset</button>
        <button onClick={() => navigator.clipboard.writeText(exportFEN())}>Copy Position</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, marginTop: 16 }}>
        <div>
          <Chessboard
            id="board"
            position={(mode === 'strict' ? fen : sandboxPos) as any}
            arePiecesDraggable={!edit}
            onPieceDrop={mode === 'strict' ? onPieceDropStrict : onPieceDropSandbox}
            onSquareClick={onSquareClick}
            customBoardStyle={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            boardWidth={580}
          />
          <div style={{ marginTop: 8, color: status ? '#b91c1c' : '#444' }}>
            {status || (mode === 'strict' ? `Turn: ${turn==='w'?'White':'Black'}` : `Turn: ${turn==='w'?'White':'Black'} (sandbox)`)}
          </div>
        </div>
        <div>
          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Position I/O</h3>
            <textarea
              placeholder={mode==='strict'?'FEN here':'Sandbox code (auto-generated on Copy)'}
              style={{ width: '100%', minHeight: 80, fontFamily: 'monospace' }}
              defaultValue=""
              onBlur={(e) => importFENText(e.target.value.trim())}
            />
            <small style={{ color: '#555' }}>Paste FEN (strict) or a sandbox code that starts with <code>SANDBOX:</code>. Blur to import.</small>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Editor</h3>
            <p style={{ marginTop: 0 }}>Toggle <b>Edit Board</b>, pick a piece, then click a square to place/remove.</p>
            <PiecePalette selected={selectedPalette} onSelect={setSelectedPalette} />
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Online Play</h3>
            {!canUseRealtime && (
              <p style={{ color: '#b45309' }}>
                Supabase env vars not set. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable.
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
                <p>Moves sync automatically in the room.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
