// Mirrors the CSS-only --mode onto <html> and, on desktop, fits the 1280x800
// reference canvas to the viewport (cover, never letterboxed).
const MODES = ["desk", "mob", "mob-l", "tab", "tab-l", "tab-p"] as const;
const REF_W = 1280;
const REF_H = 800;

export function fit() {
  const root = document.documentElement;
  const mode = getComputedStyle(root).getPropertyValue("--mode").trim() || "mob";
  root.classList.remove(...MODES, "tall", "ex1", "ex2", "ex3");
  root.classList.add(mode);
  if (mode.startsWith("tab")) root.classList.add("tab");
  if (mode.startsWith("mob")) root.classList.add("mob");
  if (mode !== "desk") return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = vw / vh > REF_W / REF_H ? vh / REF_H : vw / REF_W;
  const W = vw / s;
  const H = vh / s;
  root.style.setProperty("--s", String(s));
  root.style.setProperty("--W", String(W));
  root.style.setProperty("--H", String(H));
  if (H > 845) root.classList.add("tall");
  const extra = Math.max(0, Math.min(3, Math.floor((W - 1294) / 218.33)));
  for (let i = 1; i <= extra; i++) root.classList.add(`ex${i}`);
}

export function installStage() {
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
}

export function armIntro() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.location.pathname !== "/") return;
  const root = document.documentElement;
  root.classList.add("intro");
  setTimeout(() => root.classList.remove("intro"), 4000);
}
