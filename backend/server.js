import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e4, // signaling only — deliberately small, file bytes never flow through here
});

// roomId -> Set of socket ids currently in that room
const rooms = new Map();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const CODE_LEN = 6;

function generateCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

app.get("/health", (_req, res) => res.json({ ok: true, activeRooms: rooms.size }));

// Mints a short, shareable room code. The room itself holds no state until
// the first peer's socket actually joins it.
app.post("/api/room", (_req, res) => {
  res.json({ roomId: generateCode() });
});

app.get("/api/rooms/:code/exists", (req, res) => {
  const code = req.params.code.toUpperCase();
  res.json({ code, exists: rooms.has(code) });
});

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join-room", ({ roomId, displayName }) => {
    if (!roomId) return;
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const peers = rooms.get(roomId);

    // Tell the newcomer who is already here so it can open connections to each.
    const existingPeers = Array.from(peers);
    socket.emit("existing-peers", existingPeers);

    peers.add(socket.id);

    // Tell everyone already in the room that a new peer arrived.
    socket.to(roomId).emit("peer-joined", {
      peerId: socket.id,
      displayName: displayName || "Peer",
    });
  });

  // Pure relay for SDP offers/answers and ICE candidates. The server
  // never inspects payload content beyond routing it to the right socket.
  socket.on("signal", ({ to, data }) => {
    if (!to) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // Lets a resuming peer announce which chunks it already has verified,
  // so a sender can skip re-sending them. Metadata only — small JSON,
  // never file bytes.
  socket.on("resume-state", ({ to, receivedChunks, fileId }) => {
    if (!to) return;
    io.to(to).emit("resume-state", { from: socket.id, receivedChunks, fileId });
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket.id);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
    }
    socket.to(currentRoom).emit("peer-left", { peerId: socket.id });
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on :${PORT}`);
});
