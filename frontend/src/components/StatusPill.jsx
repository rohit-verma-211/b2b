import { CheckCircle, Warning, ArrowsClockwise, Broadcast } from "@phosphor-icons/react";

const VARIANTS = {
  idle: { cls: "border-zinc-800 bg-zinc-900/60 text-zinc-400", Icon: Broadcast, label: "idle" },
  connecting: {
    cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    Icon: ArrowsClockwise,
    label: "connecting",
  },
  connected: {
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    Icon: Broadcast,
    label: "connected",
  },
  transferring: {
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    Icon: ArrowsClockwise,
    label: "transferring",
  },
  completed: {
    cls: "border-green-500/30 bg-green-500/10 text-green-400",
    Icon: CheckCircle,
    label: "completed",
  },
  disconnected: {
    cls: "border-red-500/30 bg-red-500/10 text-red-400",
    Icon: Warning,
    label: "disconnected",
  },
  failed: { cls: "border-red-500/30 bg-red-500/10 text-red-400", Icon: Warning, label: "failed" },
  waiting: {
    cls: "border-zinc-700 bg-zinc-900 text-zinc-300",
    Icon: Broadcast,
    label: "waiting for peer",
  },
};

export default function StatusPill({ status = "idle", label, className = "" }) {
  const v = VARIANTS[status] || VARIANTS.idle;
  const { Icon } = v;
  const spin = status === "connecting" || status === "transferring";
  return (
    <span
      data-testid="connection-status-pill"
      data-status={status}
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border ${v.cls} ${className}`}
    >
      <Icon size={12} weight="bold" className={spin ? "animate-spin" : ""} />
      {label || v.label}
    </span>
  );
}
