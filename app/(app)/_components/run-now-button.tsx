"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Play } from "lucide-react";
import { runNowAction, testRunAction } from "../(workspace)/runs/actions";
import { cn } from "../_lib/cn";
import { buttonPrimary, buttonSecondary } from "./page-frame";

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

/** A cheap first run (3 prompts, one engine and country, asked once) to check the key and setup. */
export function TestRunButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={pending}
        title="Asks 3 prompts once, on one engine and country: about 3 answers"
        onClick={() =>
          start(async () => {
            const r = await testRunAction();
            if (r.ok) {
              setMessage(null);
              router.refresh();
            } else setMessage("message" in r ? r.message : "Couldn't start the test run.");
          })
        }
        className={buttonSecondary}
      >
        <FlaskConical className="size-3.5" />
        {pending ? "Starting…" : "Test run"}
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
