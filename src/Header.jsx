import React from "react";

export default function Header({ status, children }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#e2d7c3]/10 bg-black/50 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#e2d7c3]/30 bg-[#e2d7c3]/5 shadow-[0_0_12px_rgba(226,215,195,0.08)]"
          >
            <span className="font-serif text-base font-semibold leading-none select-none text-[#e2d7c3]">Σ</span>
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-xs uppercase leading-none tracking-[0.22em] text-[#e2d7c3]">
              Socratic
            </span>
            <span className="mt-1 text-[9px] uppercase leading-none tracking-[0.18em] text-[#e2d7c3]/40">
              Provocateur
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {status && (
            <span className="whitespace-nowrap font-mono text-[11px] text-[#e2d7c3]/60" aria-live="polite">
              {status}
            </span>
          )}
          {children}
        </div>
      </div>
    </header>
  );
}
