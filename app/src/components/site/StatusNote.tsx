import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "error" | "warning";

const toneClass: Record<Tone, string> = {
  neutral: "bg-white text-ink",
  success: "bg-blue/45 text-ink",
  error: "bg-red/15 text-ink",
  warning: "bg-yellow/55 text-ink",
};
const dotClass: Record<Tone, string> = {
  neutral: "bg-ink/40",
  success: "bg-[#1f7a4a]",
  error: "bg-red",
  warning: "bg-[#b58a00]",
};

export function StatusNote({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("m-0 flex items-start gap-3 rounded-[14px] border border-ink/8 px-4 py-3 text-sm leading-relaxed", toneClass[tone], className)}
    >
      <span aria-hidden="true" className={cn("mt-[7px] size-2 shrink-0 rounded-full", dotClass[tone])} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
