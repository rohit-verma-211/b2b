import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  CloudArrowUp,
  ShieldCheck,
  Lightning,
  LockKey,
  Copy,
  Check,
  X,
  ArrowRight,
  Files,
  Prohibit,
} from "@phosphor-icons/react";
import StatusPill from "../components/StatusPill";
import TransferPhase from "../components/TransferPhase";
import { createSocket, createRoom } from "../lib/socket";
import { PeerSwarm, CHUNK_SIZE_BYTES } from "../lib/webrtc";
import { generateKey, exportKeyForUrl } from "../lib/crypto";
import { useSpeedTracker, etaFrom } from "../lib/useSpeedTracker";
import { formatBytes } from "../lib/format";

export default function SendView() {
  const [phase, setPhase] = useState("pick"); // pick | room | transfer | done
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [peers, setPeers] = useState({});
  const [servedBytes, setServedBytes] = useState(0);
  const [complete, setComplete] = useState(false);

  const swarmRef = useRef(null);
  const { speed, push: pushSpeedSample, reset: resetSpeed } = useSpeedTracker();

  const anyConnected = Object.values(peers).some((s) => s === "connected");
  const status = complete ? "completed" : anyConnected ? (servedBytes > 0 ? "transferring" : "connected") : "waiting";

  useEffect(() => {
    if (phase === "room" && anyConnected) setPhase("transfer");
    if (complete) setPhase("done");
  }, [anyConnected, complete, phase]);

  const totalChunks = useMemo(() => (file ? Math.ceil(file.size / CHUNK_SIZE_BYTES) : 0), [file]);

  const shareUrl = useMemo(() => {
    if (!roomId) return null;
    return `${window.location.origin}/r/${roomId}${window.location.hash || ""}`;
  }, [roomId]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, []);

  const handleFile = (f) => {
    setError(null);
    if (f.size === 0) {
      setError("File is empty.");
      return;
    }
    setFile(f);
  };

  const createRoomAndShare = async () => {
    if (!file) return;
    setError(null);
    try {
      const rid = await createRoom();
      const key = await generateKey();
      const keyB64 = await exportKeyForUrl(key);
      window.history.replaceState({}, "", `/r/${rid}#key=${keyB64}`);
      setRoomId(rid);

      const socket = createSocket();
      const swarm = new PeerSwarm({ socket, roomId: rid, selfId: crypto.randomUUID(), onEvent: () => {} });
      swarmRef.current = swarm;
      swarm.onEvent = (type, payload) => {
        switch (type) {
          case "peer-list":
            setPeers((prev) => {
              const next = { ...prev };
              for (const id of payload.peers) if (!next[id]) next[id] = "connecting";
              return next;
            });
            break;
          case "peer-connected":
            setPeers((prev) => ({ ...prev, [payload.peerId]: "connected" }));
            break;
          case "peer-left":
            setPeers((prev) => ({ ...prev, [payload.peerId]: "disconnected" }));
            setError("A peer disconnected — rerouting remaining transfers…");
            break;
          case "served":
            setServedBytes(payload.totalServedBytes);
            pushSpeedSample(payload.totalServedBytes);
            break;
          case "complete":
            setComplete(true);
            break;
          default:
            break;
        }
      };

      socket.on("connect", async () => {
        swarm.join();
        await swarm.shareFile(file, { encrypted: true, key });
      });
      setPhase("room");
    } catch (e) {
      setError(e.message || "Failed to create room");
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = () => {
    try {
      swarmRef.current?.destroy();
    } catch (_) {}
    resetSpeed();
    window.history.replaceState({}, "", "/");
    setPhase("pick");
    setFile(null);
    setRoomId(null);
    setPeers({});
    setServedBytes(0);
    setComplete(false);
    setError(null);
  };

  const sentBytes = Math.min(servedBytes, file?.size || 0);
  const chunksDone = Math.min(Math.round(sentBytes / CHUNK_SIZE_BYTES), totalChunks);

  return (
    <div className="max-w-2xl mx-auto w-full mt-6 md:mt-12" data-testid="send-view">
      {phase === "pick" && (
        <PickPhase
          file={file}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDrop={onDrop}
          handleFile={handleFile}
          createRoom={createRoomAndShare}
          reset={reset}
          error={error}
        />
      )}
      {phase === "room" && (
        <RoomPhase
          code={roomId}
          shareUrl={shareUrl}
          file={file}
          copied={copied}
          copyLink={copyLink}
          status={status}
          reset={reset}
        />
      )}
      {(phase === "transfer" || phase === "done") && (
        <TransferPhase
          status={status}
          bytes={sentBytes}
          speed={speed}
          eta={etaFrom(speed, (file?.size || 0) - sentBytes)}
          chunksDone={chunksDone}
          chunksTotal={totalChunks}
          file={file}
          error={error}
          reset={reset}
          role="sender"
        />
      )}
    </div>
  );
}

function PickPhase({ file, dragOver, setDragOver, onDrop, handleFile, createRoom, reset, error }) {
  const inputRef = useRef(null);
  return (
    <div>
      <div className="mb-8 md:mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-950/60 text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-6">
          <ShieldCheck size={12} weight="bold" />
          zero-knowledge · e2e encrypted · no server storage
        </div>
        <h1
          className="text-4xl md:text-5xl font-semibold tracking-tight text-zinc-50"
          style={{ fontFamily: "Outfit, sans-serif" }}
          data-testid="hero-title"
        >
          Send a file, browser to browser.
        </h1>
        <p className="mt-4 text-zinc-400 max-w-lg mx-auto leading-relaxed">
          Files stream directly between your and the recipient's browser over WebRTC. Our server only
          helps them find each other — it never sees a byte of your data.
        </p>
      </div>

      <div
        data-testid="file-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed transition-all cursor-pointer min-h-[260px] flex flex-col items-center justify-center px-6 py-10 backdrop-blur-xl ${
          dragOver
            ? "border-blue-500 bg-blue-500/[0.04] text-blue-400"
            : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {!file ? (
          <>
            <CloudArrowUp size={48} weight="duotone" className="text-zinc-500 mb-4" />
            <p className="text-zinc-200 font-medium">Drop a file here, or click to browse</p>
            <p className="text-zinc-500 text-xs mt-2 font-mono">sha-256 verified · aes-gcm 256</p>
          </>
        ) : (
          <div className="w-full max-w-md" data-testid="file-preview">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-lg bg-zinc-900 border border-zinc-800 grid place-items-center">
                <Files size={22} weight="duotone" className="text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-zinc-100 font-medium truncate" data-testid="file-name" title={file.name}>
                  {file.name}
                </div>
                <div className="text-xs font-mono text-zinc-500 mt-1" data-testid="file-size">
                  {formatBytes(file.size)}
                  {file.type ? ` · ${file.type}` : ""}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="text-zinc-500 hover:text-zinc-200 transition p-1"
                data-testid="clear-file-button"
                aria-label="clear file"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-400 font-mono" data-testid="error-message">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        <FeatureList />
        <button
          onClick={createRoom}
          disabled={!file}
          data-testid="create-room-button"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-50 text-zinc-950 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed font-medium px-5 py-2.5 transition active:scale-[0.98]"
        >
          Create share link
          <ArrowRight size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function FeatureList() {
  const items = [
    { Icon: LockKey, label: "AES-GCM 256" },
    { Icon: Lightning, label: "WebRTC" },
    { Icon: ShieldCheck, label: "SHA-256" },
  ];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map(({ Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          <Icon size={12} weight="bold" />
          {label}
        </span>
      ))}
    </div>
  );
}

function RoomPhase({ code, shareUrl, file, copied, copyLink, status, reset }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 backdrop-blur-xl p-6 md:p-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-1">Room ready</div>
          <div className="text-zinc-200 text-sm">Waiting for the recipient to connect…</div>
        </div>
        <StatusPill status={status === "idle" ? "waiting" : status} />
      </div>

      <div className="text-center mb-8">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-3">share code</div>
        <div
          data-testid="room-code-display"
          className="text-5xl md:text-6xl font-mono font-bold tracking-[0.25em] text-zinc-50 select-all"
          style={{ fontFamily: "JetBrains Mono, monospace" }}
        >
          {code}
        </div>
      </div>

      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-2">share link</div>
        <div className="flex items-center w-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden focus-within:border-zinc-600 transition-all">
          <input
            readOnly
            value={shareUrl || ""}
            data-testid="share-url-input"
            className="flex-1 bg-transparent border-none text-zinc-300 font-mono text-xs md:text-sm px-4 py-3 focus:outline-none min-w-0"
          />
          <button
            onClick={copyLink}
            data-testid="copy-link-button"
            className="px-4 py-3 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors border-l border-zinc-800 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider"
          >
            {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <p className="mt-2 text-[11px] font-mono text-zinc-600">
          The decryption key is embedded in the URL fragment (#) — it never leaves the browser and is
          never sent to the signaling server.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="bg-white p-3 rounded-lg mx-auto" data-testid="qr-code">
          {shareUrl && <QRCodeSVG value={shareUrl} size={128} />}
        </div>
        <div className="text-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-md bg-zinc-900 border border-zinc-800 grid place-items-center">
              <Files size={16} weight="duotone" className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="text-zinc-200 truncate max-w-xs" title={file?.name}>
                {file?.name}
              </div>
              <div className="text-xs font-mono text-zinc-500">{file ? formatBytes(file.size) : ""}</div>
            </div>
          </div>
          <button
            onClick={reset}
            data-testid="cancel-room-button"
            className="mt-2 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-red-400 transition"
          >
            <Prohibit size={12} weight="bold" />
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}
