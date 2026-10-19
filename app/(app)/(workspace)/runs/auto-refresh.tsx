"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the page every few seconds while a run is in progress. */
export function AutoRefresh({ active, everyMs = 3_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
