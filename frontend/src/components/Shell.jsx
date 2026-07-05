import { ShieldCheck, Lightning, GithubLogo } from "@phosphor-icons/react";

const NAV_LINK =
  "font-mono text-xs uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-200 transition-colors";

export default function Shell({ children }) {
  return (
    <div
      data-testid="app-shell"
      className="min-h-screen w-full bg-black text-zinc-100 relative overflow-x-hidden"
      style={{
  background: `
    radial-gradient(circle at top left, rgba(59,130,246,0.15), transparent 40%),
    radial-gradient(circle at bottom right, rgba(139,92,246,0.15), transparent 40%),
    #09090b
  `,
}}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(59,130,246,0.14),rgba(0,0,0,0))]" />

      <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-6 max-w-6xl mx-auto">
        <a href="/" data-testid="brand-link" className="flex items-center gap-2 group">
          <div className="h-10 w-10 p-2 rounded-[50%] bg-white text-black text-mono text-shadow-blue-700 grid place-items-center font-mono font-bold text-sm">
            B2B
          </div>
          <span className="font-heading text-lg tracking-tight text-zinc-100 text-shadow-blue-700 text-bold group-hover:text-white transition">
            B2B Transfer
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-6">
          <span className={NAV_LINK} data-testid="nav-e2e">
            <ShieldCheck size={12} weight="bold" className="inline mb-0.5 mr-1" />
            E2E encrypted
          </span>
          <span className={NAV_LINK} data-testid="nav-p2p">
            <Lightning size={12} weight="bold" className="inline mb-0.5 mr-1" />
            Peer-to-peer
          </span>
          <a
            href="https://github.com/rohitverma-211/"
            target="_blank"
            rel="noreferrer"
            data-testid="nav-github"
            className={NAV_LINK}
          >
            <GithubLogo size={14} weight="bold" className="inline mb-0.5 mr-1" />
            source
          </a>
        </nav>
      </header>

      <main className="relative z-10 px-4 sm:px-6 pb-24">{children}</main>

      
    </div>
  );
}
