import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * Animated spider-web background: drifting nodes joined by threads that fade with
 * distance, plus a cursor-reactive strand. Pure canvas, no dependencies, and it
 * pauses when the tab is hidden.
 */
export function SpiderWeb({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let frame = 0;
    const pointer = { x: -9999, y: -9999 };

    const LINK_DISTANCE = 150;

    function build() {
      const parent = canvas!.parentElement;
      width = parent?.clientWidth ?? window.innerWidth;
      height = parent?.clientHeight ?? window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.round(Math.min(120, Math.max(38, (width * height) / 16000)));
      nodes = Array.from({ length: target }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.6,
      }));
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i] as Node;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j] as Node;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DISTANCE) continue;
          const strength = 1 - dist / LINK_DISTANCE;
          ctx!.strokeStyle = `rgba(255, 107, 43, ${strength * 0.16})`;
          ctx!.lineWidth = 0.6;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }

        const pd = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (pd < 190) {
          ctx!.strokeStyle = `rgba(255, 138, 84, ${(1 - pd / 190) * 0.4})`;
          ctx!.lineWidth = 0.7;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(pointer.x, pointer.y);
          ctx!.stroke();
        }

        ctx!.fillStyle =
          pd < 190 ? "rgba(255, 138, 84, 0.75)" : "rgba(255, 255, 255, 0.28)";
        ctx!.beginPath();
        ctx!.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      frame = window.requestAnimationFrame(draw);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    }

    function onPointerLeave() {
      pointer.x = -9999;
      pointer.y = -9999;
    }

    function onVisibility() {
      if (document.hidden) window.cancelAnimationFrame(frame);
      else if (!reduceMotion) frame = window.requestAnimationFrame(draw);
    }

    build();
    if (reduceMotion) {
      draw();
      window.cancelAnimationFrame(frame);
    } else {
      frame = window.requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(build);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
}
