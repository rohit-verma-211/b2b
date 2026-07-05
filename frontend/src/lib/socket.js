import { io } from "socket.io-client";

const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || "http://localhost:4000";

export function createSocket() {
  return io(SIGNAL_URL, { transports: ["websocket", "polling"] });
}

export async function createRoom() {
  const res = await fetch(`${SIGNAL_URL}/api/room`, { method: "POST" });
  const { roomId } = await res.json();
  return roomId;
}
