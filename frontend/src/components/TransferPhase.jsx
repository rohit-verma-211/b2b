import { ShieldCheck, Prohibit } from "@phosphor-icons/react";
import StatusPill from "./StatusPill";
import TransferProgress from "./TransferProgress";

export default function TransferPhase({
  status,
  bytes,
  speed,
  eta,
  chunksDone,
  chunksTotal,
  file,
  error,
  reset,
  role,
  downloadUrl,
  downloadName,
}) {
  const isDone = status === "completed";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 backdrop-blur-xl p-6 md:p-10">
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-1">
            {isDone ? (role === "receiver" ? "received" : "sent") : role === "receiver" ? "receiving" : "sending"}
          </div>
          <div
            className="text-zinc-100 truncate max-w-xs md:max-w-md"
            title={file?.name}
            data-testid="transfer-filename"
          >
            {file?.name}
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <TransferProgress
        bytes={bytes}
        total={file?.size || 0}
        speed={speed}
        eta={eta}
        chunksDone={chunksDone}
        chunksTotal={chunksTotal}
      />

      {error && (
        <p className="mt-4 text-sm text-red-400 font-mono" data-testid="transfer-error">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        <div className="text-[11px] font-mono text-zinc-600">
          <ShieldCheck size={12} weight="bold" className="inline mb-0.5 mr-1 text-green-500/80" />
          each chunk aes-gcm encrypted + sha-256 verified
        </div>
        {isDone ? (
          <div className="flex items-center gap-3">
            {role === "receiver" && downloadUrl && (
              <a
                href={downloadUrl}
                download={downloadName}
                data-testid="download-again-button"
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 px-4 py-2 text-sm transition"
              >
                Download again
              </a>
            )}
            <button
              onClick={reset}
              data-testid="send-another-button"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-50 text-zinc-950 hover:bg-white font-medium px-4 py-2 text-sm transition active:scale-[0.98]"
            >
              {role === "receiver" ? "Done" : "Send another"}
            </button>
          </div>
        ) : (
          <button
            onClick={reset}
            data-testid="cancel-transfer-button"
            className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 px-4 py-2 text-sm transition"
          >
            <Prohibit size={14} weight="bold" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
