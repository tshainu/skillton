import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/auth";

/**
 * Client half of the session idle timeout.
 *
 * The server already rejects idle sessions, but a browser left open would sit
 * on a stale screen until the next request. This watches real user activity,
 * shows a warning a minute before the cut-off, and signs out cleanly when the
 * window elapses. Pass 0 to disable.
 */

const WARN_BEFORE_MS = 60_000;
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "visibilitychange"] as const;

export function useIdleLogout(idleMinutes: number | undefined) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!idleMinutes || idleMinutes <= 0) {
      setSecondsLeft(null);
      return;
    }

    const limitMs = idleMinutes * 60_000;
    const bump = () => {
      lastActivity.current = Date.now();
      setSecondsLeft(null);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, bump, { passive: true });
    }

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      if (idleFor >= limitMs) {
        window.clearInterval(timer);
        void authClient.signOut().finally(() => {
          window.location.assign("/?signedOut=idle");
        });
        return;
      }
      const remaining = limitMs - idleFor;
      setSecondsLeft(remaining <= WARN_BEFORE_MS ? Math.ceil(remaining / 1000) : null);
    }, 1000);

    return () => {
      window.clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, bump);
    };
  }, [idleMinutes]);

  return { secondsLeft, stayActive: () => (lastActivity.current = Date.now()) };
}
