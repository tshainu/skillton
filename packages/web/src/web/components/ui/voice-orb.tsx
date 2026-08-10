import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Animated voice avatar — a circular waveform that reacts to the interviewer's
 * live audio.
 *
 * When a MediaStream is supplied the ring is driven by a real FFT of that
 * stream, so the wave genuinely follows the AI's speech. Without a stream (or
 * before audio arrives) it falls back to a gentle synthetic idle breathing
 * motion, so the avatar never looks frozen.
 */

export type OrbState = "idle" | "listening" | "speaking" | "thinking";

const COLORS: Record<OrbState, { core: string; glow: string; ring: string }> = {
  idle: { core: "#3f3f3f", glow: "rgba(255,255,255,0.06)", ring: "#4a4a4a" },
  listening: { core: "#3b82f6", glow: "rgba(59,130,246,0.28)", ring: "#3b82f6" },
  speaking: { core: "#ff6b2b", glow: "rgba(255,107,43,0.34)", ring: "#ff6b2b" },
  thinking: { core: "#a855f7", glow: "rgba(168,85,247,0.28)", ring: "#a855f7" },
};

export function VoiceOrb({
  stream,
  state = "idle",
  size = 200,
  label,
  className,
}: {
  /** Live audio to visualise. Usually the AI's remote track. */
  stream?: MediaStream | null;
  state?: OrbState;
  size?: number;
  label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    /* ---- optional real audio analysis ---- */
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let data: Uint8Array | null = null;

    if (stream && stream.getAudioTracks().length > 0) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctor();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        analyser = null;
      }
    }

    let frame = 0;
    let raf = 0;

    function amplitudes(count: number, time: number): number[] {
      if (analyser && data) {
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        const step = Math.max(1, Math.floor(data.length / count));
        return Array.from({ length: count }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data![i * step + j] ?? 0;
          return sum / step / 255;
        });
      }
      /* Synthetic idle/talking motion when no analyser is available. */
      const energy = stateRef.current === "speaking" ? 0.55 : stateRef.current === "thinking" ? 0.3 : 0.12;
      return Array.from({ length: count }, (_, i) => {
        const phase = time / 620 + i * 0.42;
        return energy * (0.55 + 0.45 * Math.sin(phase) * Math.cos(phase * 0.37));
      });
    }

    function draw() {
      frame++;
      const time = frame * 16;
      const colors = COLORS[stateRef.current];
      const center = size / 2;
      const base = size * 0.26;
      const points = 96;
      const bands = amplitudes(24, time);
      const level = bands.reduce((a, b) => a + b, 0) / bands.length;

      ctx!.clearRect(0, 0, size, size);

      /* Outer glow that breathes with the overall level. */
      const glowRadius = base * (1.55 + level * 0.7);
      const glow = ctx!.createRadialGradient(center, center, base * 0.5, center, center, glowRadius);
      glow.addColorStop(0, colors.glow);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = glow;
      ctx!.beginPath();
      ctx!.arc(center, center, glowRadius, 0, Math.PI * 2);
      ctx!.fill();

      /* Three offset waveform rings for depth. */
      for (let ring = 0; ring < 3; ring++) {
        const ringBase = base * (1 + ring * 0.14);
        const reach = size * 0.055 * (1 - ring * 0.22);
        ctx!.beginPath();
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const band = bands[Math.floor((i / points) * bands.length) % bands.length] ?? 0;
          const wobble =
            Math.sin(angle * 3 + time / (520 + ring * 180)) * 0.35 +
            Math.sin(angle * 5 - time / (700 + ring * 140)) * 0.25;
          const radius = ringBase + band * reach * 2.2 + wobble * reach * 0.5;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          if (i === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.closePath();
        ctx!.strokeStyle = colors.ring;
        ctx!.globalAlpha = 0.75 - ring * 0.22;
        ctx!.lineWidth = ring === 0 ? 2 : 1.2;
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      /* Solid core disc. */
      const coreRadius = base * (0.62 + level * 0.16);
      const core = ctx!.createRadialGradient(
        center - coreRadius * 0.3,
        center - coreRadius * 0.3,
        0,
        center,
        center,
        coreRadius,
      );
      core.addColorStop(0, `${colors.core}dd`);
      core.addColorStop(1, `${colors.core}33`);
      ctx!.fillStyle = core;
      ctx!.beginPath();
      ctx!.arc(center, center, coreRadius, 0, Math.PI * 2);
      ctx!.fill();

      /* Bars radiating from the core — the classic "voice" read. */
      const barCount = 40;
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        const band = bands[i % bands.length] ?? 0;
        const inner = coreRadius + 4;
        const outer = inner + band * size * 0.085 + 2;
        ctx!.beginPath();
        ctx!.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
        ctx!.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
        ctx!.strokeStyle = colors.ring;
        ctx!.globalAlpha = 0.25 + band * 0.65;
        ctx!.lineWidth = 2;
        ctx!.lineCap = "round";
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      source?.disconnect();
      analyser?.disconnect();
      void audioCtx?.close().catch(() => undefined);
    };
  }, [stream, size]);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        aria-hidden
        className="select-none"
      />
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      )}
    </div>
  );
}
