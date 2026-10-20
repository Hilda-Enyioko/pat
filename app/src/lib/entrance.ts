// One-shot load timeline for the landing stage (WAAPI). The marquee columns
// are driven in with a curve that hands off to the CSS loop at exactly its
// cruise speed, so there is no visible seam at HANDOFF.
const EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
const QUART = "cubic-bezier(0.25, 1, 0.5, 1)";
const QUINT = "cubic-bezier(0.22, 1, 0.36, 1)";
const HANDOFF = 2.1; // s
const CRUISE = 3.42; // % of column height per second (50% / 14.6s)
const EXTRA = 8; // % extra drift, eased out
const SAMPLES = 32;

let played = false;

const quintOut = (t: number) => 1 - Math.pow(1 - t, 5);

export function playEntrance(stage: HTMLElement): void {
  const root = document.documentElement;
  if (played || !root.classList.contains("intro")) {
    root.classList.remove("intro");
    return;
  }
  played = true;

  const all = (sel: string) => Array.from(stage.querySelectorAll<HTMLElement>(sel));
  const run = (els: HTMLElement[], frames: Keyframe[], opts: KeyframeAnimationOptions, stagger = 0) =>
    els.map((el, i) =>
      el.animate(frames, { fill: "backwards", ...opts, delay: (Number(opts.delay) || 0) + i * stagger }),
    );

  const h1 = stage.querySelector("h1");
  const anims: Animation[] = [];

  anims.push(
    ...run(all(".hdr"), [{ transform: "translateY(calc(-100% - 48px))" }, { transform: "none" }], { duration: 950, easing: EXPO }),
    ...run(all(".util > *"), [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 320, easing: QUART }, 60),
    ...run(all(".logo"), [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], { duration: 700, delay: 380, easing: EXPO }),
    ...run(all(".menu-btn"), [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 650, delay: 440, easing: EXPO }, 45),
    ...run(all(".cta"), [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 700, delay: 620, easing: EXPO }),
    ...run(all(".hero .ln > span"), [{ transform: "translateY(110%)" }, { transform: "none" }], { duration: 1000, delay: 300, easing: EXPO }, 85),
    ...run(all(".hero p"), [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 900, delay: 720, easing: QUART }),
    ...run(all(".hero .acts > *"), [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 900, delay: 840, easing: QUART }, 90),
  );

  const t0 = performance.now();
  for (const col of all(".mosaic .col")) {
    if (getComputedStyle(col).display === "none") continue;
    const up = getComputedStyle(col).animationName === "colUp";
    const v = up ? CRUISE : -CRUISE; // %/s of the column's own height
    const frames: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * HANDOFF;
      const offset = v * (t - HANDOFF) - Math.sign(v) * EXTRA * (1 - quintOut(t / HANDOFF));
      frames.push({ translate: `0 ${offset.toFixed(3)}%`, offset: i / SAMPLES });
    }
    col.style.animationPlayState = "paused";
    anims.push(col.animate(frames, { duration: HANDOFF * 1000, easing: "linear", fill: "backwards" }));
    anims.push(col.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: QUINT, fill: "backwards" }));
    setTimeout(() => { col.style.animationPlayState = ""; }, Math.max(0, t0 + HANDOFF * 1000 - performance.now()));
  }

  // Backwards fill now holds every start frame, so the CSS pre-state can go.
  root.classList.remove("intro");

  void Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
    h1?.classList.remove("masking");
    stage.dataset.entrance = "done";
  });
}
