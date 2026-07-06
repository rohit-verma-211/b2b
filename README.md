# B2B Transfer : Browser to Browser File Transfer

Drop a file, get a link. Whoever opens it pulls the file straight from your
browser over a WebRTC data channel — no upload, no storage, no size cap
imposed by a server. A small Node/Socket.io signaling server only exists to
introduce two browsers to each other; it never sees file bytes.

## Quick start

**Terminal 1 — signaling server**
```bash
cd backend
npm install
npm start          # listens on :4000
```

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Open `http://localhost:5173`, drop a file, and open the generated link in a
second browser window (or another device on the same network — swap
`localhost` for your machine's LAN IP and update `frontend/.env`'s
`VITE_SIGNAL_URL` accordingly).

## How it works

1. **Signaling.** The sender POSTs `/api/room` to mint a room id, then joins
   it over Socket.io. When a receiver opens the room link, the signaling
   server introduces the two sockets and relays SDP offers/answers and ICE
   candidates — see `backend/server.js`. That's the server's entire job; it
   is stateless about file content.
2. **Handshake.** Each browser pair opens a direct `RTCPeerConnection` with a
   single ordered `RTCDataChannel`. The peer that was already in the room
   sends the offer, so two peers never race to offer each other at once.
3. **Chunked transfer.** The file is split into 256KB chunks. This is a
   **pull protocol**, closer to BitTorrent than a raw push: each peer
   advertises which chunks it has (`have` / `have-update`), and a receiver
   requests missing chunks (`request`) from whichever connected peer has
   them, a handful in flight at a time. See `frontend/src/lib/webrtc.js`.
4. **Verification.** Every chunk is SHA-256 hashed before sending and
   re-hashed after receipt/decryption; a mismatch triggers an automatic
   re-request rather than corrupting the output file.
5. **Reassembly.** Chunks land in the browser's Origin Private File System
   (OPFS) at their correct byte offset as they arrive, so the receiver never
   holds the whole file in RAM. When every chunk is in, the file is read
   back and handed to the browser as a normal download.

## Feature checklist

**Core MVP**
- [x] Drag-and-drop share-room creation with a unique link
- [x] Socket.io signaling handshake (offer/answer/ICE relay)
- [x] Direct WebRTC data-channel transfer
- [x] Per-chunk SHA-256 verification with automatic re-request on mismatch
- [x] Live progress: percent, MB/s, ETA, verified-chunk count, connection state
- [x] Graceful disconnect handling — a dropped peer is removed from the
      swarm and its in-flight chunks are reassigned; the UI reports it
      instead of freezing
- [x] Auto-download on completion

**Brownie points**
- [x] **Multi-peer mesh.** Every peer that joins a room connects to every
  other peer already there. As soon as a receiver has a chunk, it
  advertises it and can serve it onward — so a third peer can pull
  different pieces from the original sender *and* the second peer at once.
- [x] **Large-file support.** Incoming chunks are written directly to OPFS
  at their byte offset via the Streams-backed `createWritable()` API, so
  memory use stays flat regardless of file size. Browsers without OPFS
  (older Safari, some Firefox versions) fall back to IndexedDB, which
  avoids holding the file as one giant array while receiving, though final
  assembly for the download does need to build one Blob.
- [x] **Zero-knowledge encryption.** An AES-256-GCM key is generated
  client-side and only ever placed after the `#` in the share link. The
  fragment is never sent in HTTP requests, so the signaling server has no
  way to see it. Each chunk gets a fresh random IV.
- [x] **Churn recovery / resume.** The set of received chunk indices is
  persisted to IndexedDB as it grows. If a connection drops mid-transfer,
  in-flight requests are simply reassigned to remaining peers; if the
  *page* reloads and rejoins the same room, the receiver reports its
  existing bitfield and only the missing chunks are requested — it does
  not restart from 0%.

## Known limitations (worth knowing before a demo)

- **No TURN server.** ICE is configured with a public STUN server only. Most
  home/office networks will connect directly, but a peer behind a
  symmetric NAT or restrictive corporate firewall may fail without a TURN
  relay. Adding one (e.g. coturn, or a hosted TURN provider) is a config
  change in `frontend/src/lib/webrtc.js` (`ICE_SERVERS`).
- **One file per room.** Matches the brief's "drop a file, get a link" flow.
  Sharing a second file means opening a new room.
- **Resume works within the same origin's storage.** It survives dropped
  connections and page reloads on the same device/browser profile, since
  the bitfield lives in that browser's IndexedDB — it isn't a server-side
  resume token you can hand to a different machine.
- **OPFS is Chromium-strongest.** Firefox and Safari have partial/newer
  support; the IndexedDB fallback keeps things working everywhere, just
  with the memory tradeoff noted above for very large files. Also note:
  the finished file is copied out of OPFS into a plain in-memory Blob
  right before the download is triggered — Chrome has a known bug where
  triggering a download straight from an OPFS-backed `File` object can
  fail with a generic "check internet connection" error even though the
  data itself is intact. This copy only happens once, at completion, not
  during receiving.

## Design system

Dark, Swiss/high-contrast style (Vercel/Linear-inspired): pure black
background with a subtle dot-grid pattern, zinc borders and surfaces, a
single blue accent for active/interactive state, and monospace type for
every code, hash, byte count, and speed figure so numbers don't jump the
layout as they update. Fonts: **Outfit** for headings, **IBM Plex Sans**
for body copy, **JetBrains Mono** for data. Icons are from
`@phosphor-icons/react`.

Share links use a 6-character room code (e.g. `KJAQTX`, excluding
ambiguous characters like `I`/`O`/`0`/`1`) minted by the signaling server,
with the AES key appended after `#key=` on the client. A link looks like:
`https://your-host/r/KJAQTX#key=...`. The room code is also shown as a QR
code so it can be scanned from another device.

Sender flow: **pick** a file → **room** (share code + link + QR, waiting
for a peer) → **transfer** → **done**.
Receiver flow: opening the link shows an **accept** screen (so nothing
connects until the recipient consents) → **transfer** → **done**, with a
"download again" link backed by the in-memory object URL.

## Deploying (Render + Vercel)

**1. Push this project to GitHub** (as-is — it's already a monorepo with
`backend/` and `frontend/` as separate root directories).

**2. Backend → Render**
- New → Web Service → connect your repo
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node
- Add an env var `CORS_ORIGINS` set to your Vercel URL once you have it
  (comma-separated if you need more than one origin) — leave it as `*`
  for the first deploy if you don't have the Vercel URL yet
- Render sets `PORT` automatically; `server.js` already reads
  `process.env.PORT`, so no change needed there
- Health check path (optional): `/health`
- Deploy, then copy the resulting URL, e.g. `https://your-app.onrender.com`

**3. Frontend → Vercel**
- New Project → import the same repo
- Root Directory: `frontend`
- Framework Preset: Vite (auto-detected)
- Build Command: `npm run build`, Output Directory: `dist` (defaults)
- Add an env var `VITE_SIGNAL_URL` = `https://your-app.onrender.com` (the
  Render URL from step 2)
- A `vercel.json` is already included with a catch-all rewrite to
  `index.html` — this is required so links like `/r/KJAQTX` don't 404 on
  refresh, since this is a client-routed SPA
- Deploy, then copy the resulting URL, e.g. `https://your-app.vercel.app`

**4. Close the loop**
- Go back to the Render service → Environment → set `CORS_ORIGINS` to
  your actual Vercel URL → redeploy, so the signaling server only accepts
  requests from your frontend

**5. Test it**
- Open the Vercel URL, drop a file, copy the generated link, open it on
  another device or browser profile
- Render's free tier spins down after inactivity, so the very first
  connection after a period of idleness may take ~30–60s to signal while
  the backend wakes up — the UI will just sit on "waiting for peer" during
  that window, which is expected

**Note on NAT traversal in production:** the STUN-only limitation from
earlier still applies once deployed — two peers on strict/symmetric NATs
(common on some mobile carriers and corporate networks) may fail to
connect without a TURN relay. If that happens in testing, adding a TURN
server (e.g. a Twilio/Cloudflare TURN endpoint or self-hosted coturn) to
`ICE_SERVERS` in `frontend/src/lib/webrtc.js` fixes it.

## Project structure

```
backend/
  server.js          Signaling only: rooms (6-char codes), offer/answer/ICE relay
frontend/
  src/
    lib/
      webrtc.js       PeerSwarm — mesh connections + pull-based chunk scheduler
      crypto.js       AES-GCM key gen/export/encrypt/decrypt
      hash.js         SHA-256 helper
      storage.js      OPFS/IndexedDB chunk store + resume bitfield
      protocol.js     Binary chunk framing (index + IV + hash + payload)
      socket.js       Socket.io client + room creation
      format.js       Byte/speed/duration formatting
      useSpeedTracker.js  Sliding-window speed/ETA hook (sender side)
    components/       Shell, StatusPill, TransferPhase, TransferProgress
    views/
      SendView.jsx    pick → room (code/link/QR) → transfer → done
      ReceiveView.jsx accept → transfer → done
    App.jsx           Routes to SendView or ReceiveView based on the URL
```

## Recording a demo

1. Start both servers as above.
2. Open the app in one window, drop a file, copy the link.
3. Open the link in a second window/incognito profile/device.
4. Optionally open it in a *third* window to see the mesh — watch the
   second window's "Mesh" peer count go to 2 and both peers serve chunks.
"# b2b" 
