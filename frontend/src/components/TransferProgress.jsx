import { formatBytes, formatSpeed, formatDuration } from "../lib/format";

export default function TransferProgress({
  bytes = 0,
  total = 0,
  speed = 0,
  eta = 0,
  chunksDone = 0,
  chunksTotal = 0,
}) {
  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
  return (
    <div className="w-full" data-testid="transfer-progress">
      <div className="flex justify-between items-baseline mb-2">
        <span className="font-mono text-3xl md:text-4xl text-zinc-50 tabular-nums" data-testid="progress-percent">
          {pct.toFixed(1)}
          <span className="text-zinc-500 text-lg">%</span>
        </span>
        <span
          className="font-mono text-xs uppercase tracking-widest text-zinc-500"
          data-testid="progress-chunks"
        >
          {chunksDone}/{chunksTotal} chunks
        </span>
      </div>
      <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
        <div
          data-testid="progress-bar-indicator"
          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-4 mt-4 font-mono text-xs">
        <Stat label="transferred" value={formatBytes(bytes)} testid="stat-transferred" />
        <Stat label="speed" value={formatSpeed(speed)} testid="stat-speed" />
        <Stat label="eta" value={formatDuration(eta)} testid="stat-eta" />
      </div>
    </div>
  );
}

function Stat({ label, value, testid }) {
  return (
    <div className="border border-zinc-900 rounded-lg px-3 py-2 bg-zinc-950/70">
      <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">{label}</div>
      <div className="text-zinc-100 tabular-nums truncate" data-testid={testid}>
        {value}
      </div>
    </div>
  );
}
