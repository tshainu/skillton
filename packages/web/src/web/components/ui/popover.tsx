import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Anchored dropdown panel rendered through a portal.
 *
 * In-flow `absolute` panels get trapped by the animated cards around them: the
 * page's `rise` classes apply a transform, which creates a stacking context and
 * scopes any z-index inside it, so a neighbouring card paints over the open
 * menu. Portalling to <body> with fixed coordinates takes the panel out of that
 * fight entirely.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  width = 224,
  align = "right",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const left = align === "right" ? rect.right - width : rect.left;
      setPos({
        top: rect.bottom + 6,
        /* Keep the panel on screen on narrow viewports. */
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panel}
      style={{ top: pos.top, left: pos.left, width }}
      className="fixed z-[90] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-[#111] p-1.5 shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}
