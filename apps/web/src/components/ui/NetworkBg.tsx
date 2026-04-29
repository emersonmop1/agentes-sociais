/**
 * NetworkBg — animated ambient background.
 *
 * Two layers stacked:
 *
 *   1. Canvas of 50–120 nodes (depending on viewport) connected by green
 *      lines when within CONNECT_DIST. Each node has a slow drift velocity
 *      and a sine-wave brightness pulse. Port of the Masi reference at
 *      `masi-negocios-prot/src/components/ui/NetworkBg.jsx`.
 *
 *   2. 5 large radial-gradient orbs that drift via CSS `orb-drift-1/2/3`
 *      keyframes (defined in index.css). Adds depth without burning CPU
 *      on browsers that throttle canvas in inactive tabs.
 *
 * Reduced-motion users get the orbs static and the canvas not painted —
 * each tick is a no-op when the media query matches.
 */

import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pulse: number;
}

export function NetworkBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const isMobile = window.innerWidth < 768;
    const N = reduced ? 0 : isMobile ? 50 : 120;
    const CONNECT_DIST = isMobile ? 130 : 180;

    if (nodesRef.current.length === 0) {
      for (let i = 0; i < N; i += 1) {
        nodesRef.current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 1,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const pts = nodesRef.current;
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i]!;
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += 0.008;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        for (let j = i + 1; j < pts.length; j += 1) {
          const q = pts[j]!;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.22;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(34,197,94,${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }

        const glow = (Math.sin(p.pulse) + 1) / 2;
        const a = 0.25 + glow * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,197,94,${a})`;
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    if (!reduced) {
      draw();
    }

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Canvas layer (network of nodes) */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />

      {/* Orb layer (drift gradients) */}
      <div
        style={{
          position: "absolute",
          top: "-8%",
          left: "-6%",
          width: 600,
          height: 600,
          background:
            "radial-gradient(circle, rgba(34,197,94,0.09) 0%, rgba(34,197,94,0.02) 40%, transparent 70%)",
          borderRadius: "50%",
          animation: "orb-drift-1 22s ease-in-out infinite",
          filter: "blur(1px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "15%",
          right: "-8%",
          width: 520,
          height: 520,
          background:
            "radial-gradient(circle, rgba(59,130,246,0.07) 0%, rgba(59,130,246,0.015) 40%, transparent 70%)",
          borderRadius: "50%",
          animation: "orb-drift-2 28s ease-in-out infinite",
          filter: "blur(1px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-6%",
          left: "25%",
          width: 560,
          height: 560,
          background:
            "radial-gradient(circle, rgba(34,211,238,0.06) 0%, rgba(34,211,238,0.01) 40%, transparent 70%)",
          borderRadius: "50%",
          animation: "orb-drift-3 32s ease-in-out infinite",
          filter: "blur(1px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "55%",
          left: "5%",
          width: 420,
          height: 420,
          background: "radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 65%)",
          borderRadius: "50%",
          animation: "orb-drift-1 26s ease-in-out infinite reverse",
          filter: "blur(1px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(34,197,94,0.06) 0%, transparent 55%)",
        }}
      />
    </div>
  );
}
