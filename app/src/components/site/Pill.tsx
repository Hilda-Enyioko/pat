import type { ComponentProps } from "react";
import { ArrowUpRight } from "lucide-react";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { cn } from "@/lib/utils";

type Tone = "dark" | "light" | "red";
type Size = "sm" | "md" | "lg";

const tones: Record<Tone, string> = {
  dark: "border-0 bg-ink text-white [--primary:var(--red)]",
  light: "border-ink/15 bg-white text-ink",
  red: "border-0 bg-red text-ink [--primary:var(--ink)]",
};

// The component's resting dot sits at left:20%, which lands on the label once
// the pill is sized to its text; pin it to the left padding instead.
const sizes: Record<Size, string> = {
  sm: "h-11 min-w-28 rounded-full pl-8 pr-5 text-sm [&_svg]:size-4 [&>div:last-child]:left-3.5",
  md: "h-14 min-w-36 rounded-[18px] pl-10 pr-6 text-[15px] [&_svg]:size-[18px] [&>div:last-child]:left-[18px]",
  lg: "h-[var(--btn,63px)] min-w-[116px] rounded-[22px] pl-11 pr-7 text-[17px] [&_svg]:size-5 [&>div:last-child]:left-5",
};

/** The interactive hover button, tuned to the paper/ink palette. */
export function PillButton({
  tone = "dark",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof InteractiveHoverButton> & { tone?: Tone; size?: Size }) {
  return (
    <InteractiveHoverButton
      className={cn(
        "w-auto whitespace-nowrap disabled:pointer-events-none disabled:opacity-45",
        tones[tone],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

/** Round companion to a pill, like the ticket circle in the reference header. */
export function CircleButton({ label, className, ...props }: ComponentProps<"button"> & { label: string }) {
  return (
    <button type="button" className={cn("circle-btn", className)} aria-label={label} {...props}>
      <ArrowUpRight strokeWidth={2} />
    </button>
  );
}
