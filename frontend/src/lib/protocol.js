// Wire format for a chunk sent over an RTCDataChannel:
//
//   [ 4 bytes  chunkIndex (Uint32, big-endian) ]
//   [ 12 bytes IV (all zero if the transfer is unencrypted)          ]
//   [ 32 bytes SHA-256 of the *plaintext* chunk, for post-decrypt verification ]
//   [ N bytes  payload (ciphertext if encrypted, raw bytes otherwise) ]
//
// Control messages (file-meta, have, request, ack, etc.) are sent as plain
// JSON strings on the same channel — RTCDataChannel lets you mix string and
// binary frames, and the receiver tells them apart with `typeof data`.

export const HEADER_BYTES = 4 + 12 + 32;

export function encodeChunkFrame(chunkIndex, iv, plaintextHash, payload) {
  const frame = new Uint8Array(HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, chunkIndex, false);
  frame.set(new Uint8Array(iv), 4);
  frame.set(new Uint8Array(plaintextHash), 16);
  frame.set(new Uint8Array(payload), HEADER_BYTES);
  return frame.buffer;
}

export function decodeChunkFrame(buffer) {
  const view = new DataView(buffer);
  const chunkIndex = view.getUint32(0, false);
  const iv = buffer.slice(4, 16);
  const plaintextHash = buffer.slice(16, HEADER_BYTES);
  const payload = buffer.slice(HEADER_BYTES);
  return { chunkIndex, iv, plaintextHash, payload };
}

export function hexFromBuffer(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buffersEqual(a, b) {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
