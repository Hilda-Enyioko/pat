import { useEffect, useRef } from "react";

type GlobeProps = { className?: string; spinSeconds?: number; startLon?: number; tiltDeg?: number };

export function Globe({ className, spinSeconds = 90, startLon = 8, tiltDeg = 24 }: GlobeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let start = performance.now();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const points = Array.from({ length: innerWidth < 700 ? 4800 : 9000 }, (_, i) => {
      const y = 1 - (i / 8999) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = Math.PI * (3 - Math.sqrt(5)) * i;
      return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio, innerWidth < 700 ? 1.5 : 2);
      width = rect.width; height = rect.height;
      canvas.width = width * dpr; canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (now: number) => {
      const elapsed = reduced ? 0 : now - start;
      context.clearRect(0, 0, width, height);
      const r = Math.max(height * .8, width * .52);
      const cx = width / 2, cy = height * 1.02;
      const spin = (startLon + elapsed / (spinSeconds * 1000) * 360) * Math.PI / 180;
      const tilt = tiltDeg * Math.PI / 180;
      const gradient = context.createRadialGradient(cx, cy - r * .32, r * .08, cx, cy, r);
      gradient.addColorStop(0, "rgba(15,79,184,0)"); gradient.addColorStop(.72, "rgba(15,79,184,.12)"); gradient.addColorStop(1, "rgba(24,140,255,.3)");
      context.fillStyle = gradient; context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.fill();
      context.save(); context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.clip();
      for (const point of points) {
        const x1 = point.x * Math.cos(spin) - point.z * Math.sin(spin);
        const z1 = point.x * Math.sin(spin) + point.z * Math.cos(spin);
        const y = point.y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z = point.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        if (z <= 0) continue;
        const px = cx + x1 * r, py = cy - y * r;
        const size = (0.45 + z * .85) * Math.max(r / 640, .65);
        context.globalAlpha = .18 + z * .75;
        context.fillStyle = `rgb(${70 + Math.round(70 * z)},${165 + Math.round(35 * z)},255)`;
        context.fillRect(px, py, size, size);
      }
      context.restore();
      context.globalAlpha = .7 + Math.sin(now / 3000) * .12;
      context.strokeStyle = "rgba(110,184,255,.8)"; context.lineWidth = 1.5; context.shadowBlur = 28; context.shadowColor = "#188cff";
      context.beginPath(); context.arc(cx, cy, r, 0, Math.PI * 2); context.stroke(); context.shadowBlur = 0;
      context.globalAlpha = 1;
      for (let i = 0; i < 9; i++) {
        const phase = (now / 5000 + i / 9) % 1; const a = phase * Math.PI * 2;
        const sx = cx + Math.cos(a) * r * .98, sy = cy + Math.sin(a) * r * .98 * .34;
        context.fillStyle = "#b8e1ff"; context.shadowBlur = 10; context.shadowColor = "#188cff"; context.beginPath(); context.arc(sx, sy, 2, 0, Math.PI * 2); context.fill();
      }
      context.shadowBlur = 0;
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); draw(performance.now());
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [spinSeconds, startLon, tiltDeg]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
