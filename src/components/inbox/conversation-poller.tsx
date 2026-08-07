"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-refresh da conversa a cada intervalMs.
 * Pausa quando a aba está em background (visibility API).
 * Lock evita refresh sobreposto.
 */
export function ConversationPoller({
  intervalMs = 10000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const refreshing = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function tick() {
      if (document.visibilityState !== "visible") return;
      if (refreshing.current) return;
      refreshing.current = true;
      router.refresh();
      setTimeout(() => {
        refreshing.current = false;
      }, 1000);
    }

    function start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
