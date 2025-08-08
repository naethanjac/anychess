# AnyChess

Set up **any** board/position (valid or invalid) and play:
- **Strict mode** (real chess rules via chess.js) — supports a simple built‑in bot
- **Sandbox** (god mode) — drag pieces anywhere; no legality checks
- **Pass & Play** locally
- **Online** via Supabase Realtime (optional: plug env vars)

## Quickstart (Local)

1) Install Node 18+.
2) Install deps and run:
   ```bash
   npm i
   npm run dev
   ```
3) Open http://localhost:3000

### Bot play
Select **Play: Vs Bot** in Strict mode. The bot is a lightweight 1‑ply capture‑preferring engine.

### Editing positions
Click **Edit Board** → pick a piece in the palette → click squares to place/remove.
- In Strict mode, arbitrary edits switch you to Sandbox (since chess.js requires valid FEN).
- Use **Copy Position** to copy shareable FEN (strict) or a sandbox code starting with `SANDBOX:`.

## Online (optional, free)

Backed by **Supabase Realtime** (broadcast channels). Free tier is fine.

1) Create a Supabase project → copy **Project URL** and **anon public key**.
2) Create `.env.local` from `.env.local.example` and fill the two values.
3) Restart `npm run dev`.

In the app: **Online (Supabase)** → **Create Room** or **Join** with a 6‑char code.

> No database or tables needed. We use Realtime broadcast only.

## Deploy (Vercel, free)

1) Push this repo to GitHub.
2) In Vercel, **New Project** → import the repo.
3) (Optional) Add the two env vars to enable Online play.
4) Deploy. That’s it.

---

### Tech choices
- **Next.js + React 18**
- **react-chessboard** for the UI board
- **chess.js** for strict rules
- Simple JS bot (no Stockfish/wasm required)
- Supabase Realtime channels for online sync

License: MIT