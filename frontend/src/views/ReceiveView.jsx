import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, DownloadSimple, LockKey, Files, ArrowLeft } from "@phosphor-icons/react";
import { createSocket } from "../lib/socket";
import { PeerSwarm, CHUNK_SIZE_BYTES } from "../lib/webrtc";
import { importKeyFromUrl } from "../lib/crypto";
import StatusPill from "../components/StatusPill";
import TransferPhase from "../components/TransferPhase";

export default function ReceiveView({ roomId }) {
  const code = (roomId || "").toUpperCase();

  const [phase, setPhase] = useState("prepare"); // prepare | transfer | done
  const [error, setError] = useState(null);
  const [keyValid, setKeyValid] = useState(false);
  const [fileMeta, setFileMeta] = useState(null);
  const [peers, setPeers] = useState({});
  const [progress, setProgress] = useState({ receivedBytes: 0, totalBytes: 0, speedBps: 0, receivedChunks: 0 });
  const [complete, setComplete] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);

  const swarmRef = useRef(null);
  const keyRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const keyB64 = hashParams.get("key");
        if (!keyB64) {
          setError("This link is missing the decryption key. It must include #key=... at the end.");
          return;
        }
        keyRef.current = await importKeyFromUrl(keyB64);
        setKeyValid(true);
      } catch (e) {
        setError("Invalid decryption key.");
      }
    })();
    return () => swarmRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyConnected = Object.values(peers).some((s) => s === "connected");
  const status = complete ? "completed" : anyConnected ? (fileMeta ? "transferring" : "connected") : "waiting";

  const totalChunks = useMemo(
    () => (fileMeta ? Math.ceil(fileMeta.size / (fileMeta.chunkSize || CHUNK_SIZE_BYTES)) : 0),
    [fileMeta]
  );

  const accept = async () => {
    setError(null);
    try {
      const socket = createSocket();
      const swarm = new PeerSwarm({ socket, roomId: code, selfId: crypto.randomUUID(), onEvent: () => {} });
      swarmRef.current = swarm;
      swarm.setDownloadKey(keyRef.current);
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
          case "file-meta":
            setFileMeta(payload);
            break;
          case "progress":
            setError(null);
            setProgress((p) => ({ ...p, ...payload }));
            break;
          case "chunk-error":
            setError(`Chunk ${payload.chunkIndex} failed verification — re-requesting…`);
            break;
          case "already-complete":
            setComplete(true);
            setDownloadUrl(payload.downloadUrl || null);
            break;
          case "complete":
            setComplete(true);
            setDownloadUrl(payload.downloadUrl || null);
            break;
          default:
            break;
        }
      };
      socket.on("connect", () => swarm.join());
      setPhase("transfer");
    } catch (e) {
      setError(e.message || "Failed to join");
    }
  };

  useEffect(() => {
    if (complete) setPhase("done");
  }, [complete]);

  const reset = () => {
    try {
      swarmRef.current?.destroy();
    } catch (_) {}
    window.location.href = "/";
  };

  return (
    <div className="max-w-2xl mx-auto w-full mt-6 md:mt-12" data-testid="receive-view">
      {phase === "prepare" && !error && (
        <PreparePhase codeUpper={code} keyValid={keyValid} accept={accept} />
      )}
      {phase === "prepare" && error && <ErrorPhase message={error} />}
      {(phase === "transfer" || phase === "done") && (
        <TransferPhase
          status={status}
          bytes={progress.receivedBytes}
          speed={progress.speedBps}
          eta={progress.speedBps > 0 ? (progress.totalBytes - progress.receivedBytes) / progress.speedBps : 0}
          chunksDone={progress.receivedChunks}
          chunksTotal={totalChunks}
          file={fileMeta}
          error={error}
          reset={reset}
          role="receiver"
          downloadUrl={downloadUrl}
          downloadName={fileMeta?.name}
        />
      )}
    </div>
  );
}

function PreparePhase({ codeUpper, keyValid, accept }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 backdrop-blur-xl p-6 md:p-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-1">
            incoming transfer
          </div>
          <div
            className="text-3xl md:text-4xl font-mono font-bold tracking-[0.25em] text-zinc-50"
            data-testid="receive-code"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {codeUpper}
          </div>
        </div>
        <StatusPill status="waiting" label="ready" />
      </div>

      <div className="space-y-3 text-sm text-zinc-400 mb-8">
        <Row Icon={ShieldCheck} text="Verified end-to-end encrypted (AES-GCM 256)." />
        <Row Icon={LockKey} text="Decryption key stays in your URL — never sent to any server." />
        <Row Icon={Files} text="File is streamed directly from the sender's browser." />
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <a
          href="/"
          data-testid="back-link"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition"
        >
          <ArrowLeft size={14} weight="bold" />
          send a file instead
        </a>
        <button
          onClick={accept}
          disabled={!keyValid}
          data-testid="accept-transfer-button"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-50 text-zinc-950 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed font-medium px-5 py-2.5 transition active:scale-[0.98]"
        >
          <DownloadSimple size={16} weight="bold" />
          Accept &amp; connect
        </button>
      </div>
    </div>
  );
}

function Row({ Icon, text }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} weight="bold" className="mt-0.5 text-blue-400" />
      <span>{text}</span>
    </div>
  );
}

function ErrorPhase({ message }) {
  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-8 text-center" data-testid="receive-error">
      <div className="text-red-400 font-medium mb-2">Can't open this link</div>
      <p className="text-sm text-zinc-400 font-mono">{message}</p>
      <a
        href="/"
        className="mt-6 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition"
      >
        <ArrowLeft size={14} weight="bold" />
        back home
      </a>
    </div>
  );
}
