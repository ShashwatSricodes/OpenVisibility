"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { runNowAction } from "../(workspace)/runs/actions";
import { cn } from "../_lib/cn";
import { buttonPrimary } from "./page-frame";

/** Starts a run of every active prompt, asking first if it would pass the free tier. */
export function RunNowButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const go = (force = false) =>
    start(async () => {
      const r = await runNowAction(force);
      if (r.ok) {
        setMessage(null);
        router.push("/runs");
        router.refresh();
      } else if ("confirm" in r) {
        if (confirm(r.confirm)) go(true);
      } else {
        setMessage(r.message);
      }
    });

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => go()}
        disabled={pending}
        className={cn(buttonPrimary, className)}
      >
        <Play className="size-3.5" />
        {pending ? "Starting…" : "Run now"}
      </button>
      {message && (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-line bg-panel p-2 text-xs text-bad shadow-lg"
        >
          {message}
        </span>
      )}
    </span>
  );
}
