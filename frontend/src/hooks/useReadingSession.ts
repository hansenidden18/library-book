import { useEffect, useRef } from "react";
import { endSessionBeacon, pingSession, saveProgress, startSession } from "../api/client";
import type { Progress } from "../api/types";

const PING_INTERVAL = 30_000;
const SAVE_DEBOUNCE = 1_500;

/**
 * Manages a reading session for the open document:
 *  - starts a session on mount, ends it (via sendBeacon) on unmount/unload
 *  - heartbeats every 30s, but only while the tab is visible
 *  - exposes a debounced reportProgress() the reader calls on position change
 */
export function useReadingSession(documentId: number) {
  const sessionId = useRef<number | null>(null);
  const lastPercent = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    startSession(documentId).then((s) => {
      if (cancelled) {
        endSessionBeacon(s.id);
        return;
      }
      sessionId.current = s.id;
    });

    interval = setInterval(() => {
      if (document.visibilityState === "visible" && sessionId.current) {
        pingSession(sessionId.current, lastPercent.current);
      }
    }, PING_INTERVAL);

    const onUnload = () => {
      if (sessionId.current) endSessionBeacon(sessionId.current, lastPercent.current);
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (sessionId.current) endSessionBeacon(sessionId.current, lastPercent.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const reportProgress = (patch: Partial<Progress>) => {
    if (typeof patch.percent === "number") lastPercent.current = patch.percent;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProgress(documentId, patch);
    }, SAVE_DEBOUNCE);
  };

  return { reportProgress };
}
