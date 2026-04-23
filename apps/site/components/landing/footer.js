export function Footer() {
  return (
    <footer className="border-t border-white/6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mono-copy text-[13px] uppercase tracking-[0.28em] text-[var(--accent)]">Infopunks</p>
          <p className="section-copy mt-3">The coordination layer for agent economies.</p>
        </div>
        <p className="mono-copy text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Trust Score™ / dark mode only / live by default</p>
      </div>
    </footer>
  );
}
