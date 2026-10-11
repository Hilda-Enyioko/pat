export function armEntrance() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("anim");
  const finish = () => document.documentElement.classList.add("go");
  const fonts = document.fonts?.ready;
  if (fonts) Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 900))]).then(finish);
  else finish();
  const cleanup = () => { document.documentElement.classList.remove("anim", "go"); };
  document.addEventListener("animationend", (event) => { if ((event.target as HTMLElement).classList?.contains("scroll-cue")) cleanup(); }, { capture: true, once: true });
  setTimeout(cleanup, 2600);
}
