import type { ReactNode } from "react";

export const inputClass =
  "h-14 w-full rounded-[14px] border border-input bg-white px-4 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink/35 focus-visible:border-ink focus-visible:shadow-[0_0_0_4px_rgba(15,15,14,.08)] disabled:opacity-55 aria-invalid:border-red";

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? <span className="text-sm font-medium text-red">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
