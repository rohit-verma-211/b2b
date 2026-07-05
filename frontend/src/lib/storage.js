// Handles where incoming chunks land.
//
// - If the Origin Private File System is available (Chromium-based browsers),
//   we write each chunk directly to a positioned offset in a private OPFS
//   file. Nothing ever has to sit fully in JS memory, so this scales past
//   the ~50MB-in-RAM limit of a plain FileReader/Blob approach.
// - Otherwise we fall back to storing chunk Blobs in IndexedDB. This still
//   avoids holding the whole file in a single in-memory array while
//   receiving, though final assembly for download does require building one
//   Blob from all the parts.
//
// Either way, the set of chunk indices already written is persisted so a
// dropped connection can resume from where it left off instead of
// restarting at 0%.

const DB_NAME = "mars-p2p-share";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks"); // key: `${fileId}:${index}`
      }
      if (!db.objectStoreNames.contains("bitfields")) {
        db.createObjectStore("bitfields"); // key: fileId, value: number[]
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(storeName, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function opfsSupported() {
  return "storage" in navigator && "getDirectory" in navigator.storage;
}

export class ChunkStore {
  constructor(fileId, totalChunks, chunkSize, totalSize) {
    this.fileId = fileId;
    this.totalChunks = totalChunks;
    this.chunkSize = chunkSize;
    this.totalSize = totalSize;
    this.received = new Set();
    this.useOpfs = false;
    this.opfsHandle = null;
    this.opfsWritable = null;
  }

  async init() {
    const existing = await idbGet("bitfields", this.fileId);
    if (existing) this.received = new Set(existing);

    this.useOpfs = await opfsSupported();
    if (this.useOpfs) {
      try {
        const root = await navigator.storage.getDirectory();
        this.opfsHandle = await root.getFileHandle(`${this.fileId}.part`, {
          create: true,
        });
        this.opfsWritable = await this.opfsHandle.createWritable({
          keepExistingData: true,
        });
      } catch (e) {
        console.warn("OPFS unavailable, falling back to IndexedDB", e);
        this.useOpfs = false;
      }
    }
    return this.received; // resumed bitfield, may be empty
  }

  hasChunk(index) {
    return this.received.has(index);
  }

  missingChunks() {
    const missing = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.received.has(i)) missing.push(i);
    }
    return missing;
  }

  isComplete() {
    return this.received.size === this.totalChunks;
  }

  async writeChunk(index, arrayBuffer) {
    if (this.received.has(index)) return; // already have it, ignore dupes
    if (this.useOpfs) {
      await this.opfsWritable.write({
        type: "write",
        data: arrayBuffer,
        position: index * this.chunkSize,
      });
    } else {
      await idbSet("chunks", `${this.fileId}:${index}`, arrayBuffer);
    }
    this.received.add(index);
    // Persist the bitfield every write — small array, cheap, and it's what
    // makes resume-after-reconnect possible.
    await idbSet("bitfields", this.fileId, Array.from(this.received));
  }

  // Needed so this peer can re-serve chunks to a third peer in mesh mode.
  async readChunk(index) {
    if (this.useOpfs) {
      const file = await this.opfsHandle.getFile();
      const start = index * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.totalSize);
      return file.slice(start, end).arrayBuffer();
    }
    return idbGet("chunks", `${this.fileId}:${index}`);
  }

  async finalizeAndDownload(filename, mime) {
    let url;
    if (this.useOpfs) {
      await this.opfsWritable.close();
      const opfsFile = await this.opfsHandle.getFile();
      // Chrome has a known issue where a blob: URL created straight from an
      // OPFS-backed File can fail the actual download with a generic
      // "check internet connection" error. Copying the bytes into a plain
      // in-memory Blob first avoids it. This is a one-time copy at the very
      // end of the transfer, not during receiving, so it doesn't reintroduce
      // the memory ceiling we avoided while writing chunks.
      const arrayBuffer = await opfsFile.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: mime });
      url = triggerDownload(blob, filename, mime);
    } else {
      const parts = [];
      for (let i = 0; i < this.totalChunks; i++) {
        parts.push(await idbGet("chunks", `${this.fileId}:${i}`));
      }
      const blob = new Blob(parts, { type: mime });
      url = triggerDownload(blob, filename, mime);
    }
    await this.cleanup();
    return url;
  }

  async cleanup() {
    try {
      const db = await openDb();
      const tx = db.transaction(["chunks", "bitfields"], "readwrite");
      tx.objectStore("bitfields").delete(this.fileId);
      if (!this.useOpfs) {
        for (let i = 0; i < this.totalChunks; i++) {
          tx.objectStore("chunks").delete(`${this.fileId}:${i}`);
        }
      }
    } catch (e) {
      console.warn("cleanup failed (non-fatal)", e);
    }
    if (this.useOpfs) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(`${this.fileId}.part`);
      } catch (e) {
        // already gone, fine
      }
    }
  }
}

function triggerDownload(blobOrFile, filename, mime) {
  const blob =
    blobOrFile instanceof Blob ? blobOrFile : new Blob([blobOrFile], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}
