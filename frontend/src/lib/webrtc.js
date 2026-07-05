import { encodeChunkFrame, decodeChunkFrame, buffersEqual } from "./protocol";
import { sha256 } from "./hash";
import { encryptChunk, decryptChunk } from "./crypto";
import { ChunkStore } from "./storage";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
// No TURN server is configured — this is a direct-P2P demo. Peers behind a
// symmetric NAT / restrictive firewall may fail to connect; see README.

const CHUNK_SIZE = 256 * 1024; // 256KB
const MAX_CONCURRENT_PER_PEER = 4;
const REQUEST_TIMEOUT_MS = 8000;
const BUFFERED_AMOUNT_HIGH = 4 * 1024 * 1024;
const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024;

// One room == one shared file for the lifetime of the swarm, matching the
// "drop a file, get a room link" flow in the brief. That keeps the wire
// protocol simple (chunks don't need a fileId tag) while still allowing a
// third peer to mesh-download from whichever peers already hold pieces.

export class PeerSwarm {
  constructor({ socket, roomId, selfId, onEvent }) {
    this.socket = socket;
    this.roomId = roomId;
    this.selfId = selfId;
    this.onEvent = onEvent || (() => {});

    this.peers = new Map(); // peerId -> { pc, dc, haveFull, haveSet, inFlight, connected }
    this.sourceFile = null; // { fileId, file, name, mime, size, chunkSize, totalChunks, encrypted, key }
    this.download = null; // { fileId, name, mime, size, chunkSize, totalChunks, encrypted, key, store, missing:Set, requested:Map }
    this.speedWindow = [];

    this._bindSocket();
  }

  join() {
    this.socket.emit("join-room", { roomId: this.roomId });
  }

  // ---- signaling plumbing ----

  _bindSocket() {
    this.socket.on("existing-peers", (peerIds) => {
      // We're the newcomer. Existing peers will each send us an offer.
      this.onEvent("peer-list", { peers: peerIds });
    });

    this.socket.on("peer-joined", ({ peerId }) => {
      this._connectToPeer(peerId, true); // we're already here, so we offer
      this.onEvent("peer-list", { peers: [...this.peers.keys(), peerId] });
    });

    this.socket.on("peer-left", ({ peerId }) => {
      this._teardownPeer(peerId);
      this.onEvent("peer-left", { peerId });
      this._scheduleRequests();
    });

    this.socket.on("signal", async ({ from, data }) => {
      await this._handleSignal(from, data);
    });
  }

  // ---- connection setup ----

  _getOrCreatePeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = {
      pc,
      dc: null,
      haveFull: false,
      haveSet: new Set(),
      inFlight: new Map(), // chunkIndex -> timestamp
      connected: false,
    };
    this.peers.set(peerId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit("signal", {
          to: peerId,
          data: { type: "candidate", candidate: e.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this._teardownPeer(peerId);
        this.onEvent("peer-left", { peerId });
        this._scheduleRequests();
      }
    };

    pc.ondatachannel = (e) => {
      entry.dc = e.channel;
      this._setupDataChannel(peerId, entry);
    };

    return entry;
  }

  async _connectToPeer(peerId, isOfferer) {
    const entry = this._getOrCreatePeer(peerId);
    if (isOfferer) {
      const dc = entry.pc.createDataChannel("file-transfer", { ordered: true });
      entry.dc = dc;
      this._setupDataChannel(peerId, entry);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this.socket.emit("signal", {
        to: peerId,
        data: { type: "offer", sdp: offer },
      });
    }
  }

  async _handleSignal(from, data) {
    const entry = this._getOrCreatePeer(from);
    if (data.type === "offer") {
      await entry.pc.setRemoteDescription(data.sdp);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      this.socket.emit("signal", { to: from, data: { type: "answer", sdp: answer } });
    } else if (data.type === "answer") {
      await entry.pc.setRemoteDescription(data.sdp);
    } else if (data.type === "candidate") {
      try {
        await entry.pc.addIceCandidate(data.candidate);
      } catch (e) {
        console.warn("ICE candidate error (usually harmless)", e);
      }
    }
  }

  _teardownPeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    // Return any chunks we'd requested from this peer to the missing pool.
    if (this.download) {
      for (const idx of entry.inFlight.keys()) {
        this.download.requested.delete(idx);
      }
    }
    try {
      entry.dc?.close();
      entry.pc.close();
    } catch (_) {}
    this.peers.delete(peerId);
  }

  _setupDataChannel(peerId, entry) {
    const dc = entry.dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

    dc.onopen = async () => {
      entry.connected = true;
      this.onEvent("peer-connected", { peerId });

      if (this.sourceFile) {
        this._sendJson(dc, {
          type: "file-meta",
          fileId: this.sourceFile.fileId,
          name: this.sourceFile.name,
          mime: this.sourceFile.mime,
          size: this.sourceFile.size,
          chunkSize: this.sourceFile.chunkSize,
          totalChunks: this.sourceFile.totalChunks,
          encrypted: this.sourceFile.encrypted,
        });
        this._sendJson(dc, { type: "have", full: true });
      } else if (this.download) {
        this._sendJson(dc, {
          type: "file-meta",
          fileId: this.download.fileId,
          name: this.download.name,
          mime: this.download.mime,
          size: this.download.size,
          chunkSize: this.download.chunkSize,
          totalChunks: this.download.totalChunks,
          encrypted: this.download.encrypted,
        });
        this._sendJson(dc, {
          type: "have",
          chunks: Array.from(this.download.store.received),
        });
      }
      this._scheduleRequests();
    };

    dc.onclose = () => {
      entry.connected = false;
    };

    dc.onmessage = (e) => this._handleMessage(peerId, entry, e.data);
  }

  _sendJson(dc, obj) {
    if (dc.readyState === "open") dc.send(JSON.stringify(obj));
  }

  async _sendWithBackpressure(dc, buffer) {
    if (dc.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
      await new Promise((resolve) => {
        dc.addEventListener("bufferedamountlow", resolve, { once: true });
      });
    }
    if (dc.readyState === "open") dc.send(buffer);
  }

  // ---- message routing ----

  async _handleMessage(peerId, entry, data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      await this._handleControl(peerId, entry, msg);
    } else {
      await this._handleChunkFrame(peerId, entry, data);
    }
  }

  async _handleControl(peerId, entry, msg) {
    switch (msg.type) {
      case "file-meta": {
        if (this.sourceFile || this.download) break; // single-file-per-room
        const store = new ChunkStore(msg.fileId, msg.totalChunks, msg.chunkSize, msg.size);
        const resumed = await store.init();
        this.download = {
          fileId: msg.fileId,
          name: msg.name,
          mime: msg.mime,
          size: msg.size,
          chunkSize: msg.chunkSize,
          totalChunks: msg.totalChunks,
          encrypted: msg.encrypted,
          key: this.pendingKey || null,
          store,
          requested: new Map(), // chunkIndex -> peerId
          receivedBytes: Array.from(resumed).length * msg.chunkSize,
        };
        this.onEvent("file-meta", {
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          encrypted: msg.encrypted,
          resumedChunks: resumed.size,
          totalChunks: msg.totalChunks,
        });
        if (store.isComplete()) {
          const url = await store.finalizeAndDownload(msg.name, msg.mime);
          this.onEvent("already-complete", { downloadUrl: url });
          break;
        }
        // tell every connected peer what we already have, then request more
        for (const [, e2] of this.peers) {
          if (e2.dc?.readyState === "open") {
            this._sendJson(e2.dc, { type: "have", chunks: Array.from(resumed) });
          }
        }
        this._scheduleRequests();
        break;
      }
      case "have": {
        if (msg.full) entry.haveFull = true;
        if (msg.chunks) for (const c of msg.chunks) entry.haveSet.add(c);
        this._scheduleRequests();
        break;
      }
      case "have-update": {
        entry.haveSet.add(msg.chunkIndex);
        this._scheduleRequests();
        break;
      }
      case "request": {
        await this._serveChunk(peerId, entry, msg.chunkIndex);
        break;
      }
      default:
        break;
    }
  }

  _peerHasChunk(entry, index) {
    return entry.haveFull || entry.haveSet.has(index);
  }

  async _serveChunk(peerId, entry, chunkIndex) {
    let plaintext;
    if (this.sourceFile) {
      const start = chunkIndex * this.sourceFile.chunkSize;
      const end = Math.min(start + this.sourceFile.chunkSize, this.sourceFile.size);
      plaintext = await this.sourceFile.file.slice(start, end).arrayBuffer();
    } else if (this.download?.store.hasChunk(chunkIndex)) {
      plaintext = await this.download.store.readChunk(chunkIndex);
    } else {
      return; // we don't have it (shouldn't normally be asked)
    }

    const plaintextHash = await sha256(plaintext);
    let iv = new Uint8Array(12);
    let payload = plaintext;

    const key = this.sourceFile?.key || this.download?.key;
    const encrypted = this.sourceFile?.encrypted ?? this.download?.encrypted;
    if (encrypted && key) {
      const enc = await encryptChunk(key, plaintext);
      iv = enc.iv;
      payload = enc.ciphertext;
    }

    const frame = encodeChunkFrame(chunkIndex, iv, plaintextHash, payload);
    await this._sendWithBackpressure(entry.dc, frame);
    this._servedBytes = (this._servedBytes || 0) + plaintext.byteLength;
    this.onEvent("served", { peerId, chunkIndex, totalServedBytes: this._servedBytes });
  }

  async _handleChunkFrame(peerId, entry, buffer) {
    if (!this.download) return;
    const { chunkIndex, iv, plaintextHash, payload } = decodeChunkFrame(buffer);
    entry.inFlight.delete(chunkIndex);
    this.download.requested.delete(chunkIndex);

    let plaintext = payload;
    if (this.download.encrypted && this.download.key) {
      try {
        plaintext = await decryptChunk(this.download.key, new Uint8Array(iv), payload);
      } catch (e) {
        this.onEvent("chunk-error", { chunkIndex, reason: "decrypt-failed" });
        this._scheduleRequests();
        return;
      }
    }

    const actualHash = await sha256(plaintext);
    if (!buffersEqual(actualHash, plaintextHash)) {
      this.onEvent("chunk-error", { chunkIndex, reason: "hash-mismatch" });
      this._scheduleRequests(); // will simply re-request
      return;
    }

    await this.download.store.writeChunk(chunkIndex, plaintext);
    this._recordSpeedSample(plaintext.byteLength);

    // Let every other connected peer know we now have this piece too —
    // this is what makes mesh swarming work: any peer can re-seed.
    for (const [pid, e2] of this.peers) {
      if (pid !== peerId && e2.dc?.readyState === "open") {
        this._sendJson(e2.dc, { type: "have-update", chunkIndex });
      }
    }

    const receivedCount = this.download.store.received.size;
    this.onEvent("progress", {
      receivedChunks: receivedCount,
      totalChunks: this.download.totalChunks,
      receivedBytes: Math.min(
        receivedCount * this.download.chunkSize,
        this.download.size
      ),
      totalBytes: this.download.size,
      speedBps: this._currentSpeedBps(),
    });

    if (this.download.store.isComplete()) {
      const url = await this.download.store.finalizeAndDownload(this.download.name, this.download.mime);
      this.onEvent("complete", { name: this.download.name, downloadUrl: url });
    } else {
      this._scheduleRequests();
    }
  }

  // ---- pull scheduler ----

  _scheduleRequests() {
    if (!this.download) return;
    const dl = this.download;
    if (dl.store.isComplete()) return;

    const now = Date.now();
    // reclaim timed-out requests
    for (const [idx, peerId] of dl.requested) {
      const entry = this.peers.get(peerId);
      const ts = entry?.inFlight.get(idx);
      if (!entry || !entry.connected || (ts && now - ts > REQUEST_TIMEOUT_MS)) {
        dl.requested.delete(idx);
        entry?.inFlight.delete(idx);
      }
    }

    const missing = dl.store.missingChunks().filter((i) => !dl.requested.has(i));
    if (missing.length === 0) return;

    const peerIds = Array.from(this.peers.keys()).filter(
      (id) => this.peers.get(id).connected
    );
    let cursor = 0;
    for (const idx of missing) {
      let assigned = false;
      for (let tries = 0; tries < peerIds.length; tries++) {
        const peerId = peerIds[cursor % peerIds.length];
        cursor++;
        const entry = this.peers.get(peerId);
        if (
          entry &&
          entry.connected &&
          this._peerHasChunk(entry, idx) &&
          entry.inFlight.size < MAX_CONCURRENT_PER_PEER
        ) {
          entry.inFlight.set(idx, now);
          dl.requested.set(idx, peerId);
          this._sendJson(entry.dc, { type: "request", chunkIndex: idx });
          assigned = true;
          break;
        }
      }
      if (!assigned) continue;
    }
  }

  _recordSpeedSample(bytes) {
    const now = performance.now();
    this.speedWindow.push({ t: now, bytes });
    const cutoff = now - 3000;
    this.speedWindow = this.speedWindow.filter((s) => s.t >= cutoff);
  }

  _currentSpeedBps() {
    if (this.speedWindow.length < 2) return 0;
    const totalBytes = this.speedWindow.reduce((a, s) => a + s.bytes, 0);
    const span = (this.speedWindow[this.speedWindow.length - 1].t - this.speedWindow[0].t) / 1000;
    return span > 0 ? totalBytes / span : 0;
  }

  // ---- public API for the sender ----

  async shareFile(file, { encrypted, key } = {}) {
    const fileId = crypto.randomUUID();
    this.sourceFile = {
      fileId,
      file,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(file.size / CHUNK_SIZE),
      encrypted: !!encrypted,
      key: key || null,
    };
    for (const [, entry] of this.peers) {
      if (entry.dc?.readyState === "open") {
        this._sendJson(entry.dc, {
          type: "file-meta",
          fileId,
          name: this.sourceFile.name,
          mime: this.sourceFile.mime,
          size: this.sourceFile.size,
          chunkSize: this.sourceFile.chunkSize,
          totalChunks: this.sourceFile.totalChunks,
          encrypted: this.sourceFile.encrypted,
        });
        this._sendJson(entry.dc, { type: "have", full: true });
      }
    }
    return this.sourceFile;
  }

  // Called by the receiver UI once it has imported the decryption key from
  // the URL fragment, in case file-meta arrived before the key was ready.
  setDownloadKey(key) {
    this.pendingKey = key;
    if (this.download) this.download.key = key;
  }

  destroy() {
    for (const peerId of Array.from(this.peers.keys())) this._teardownPeer(peerId);
    this.socket.removeAllListeners("existing-peers");
    this.socket.removeAllListeners("peer-joined");
    this.socket.removeAllListeners("peer-left");
    this.socket.removeAllListeners("signal");
  }
}

export const CHUNK_SIZE_BYTES = CHUNK_SIZE;
