"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../../_components/page-frame";
import { findTargetsAction, requestBriefAction, skipTargetAction } from "./actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.message ?? null);
      router.refresh();
    });
  return { pending, message, run };
}

export function FindTargetsButton({ first = false }: { first?: boolean }) {
  const { pending, message, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      {message && <span className="text-xs text-fg-subtle">{message}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(findTargetsAction)}
        className={first ? buttonPrimary : buttonSecondary}
      >
        <Search className="size-3.5" />
        {pending ? "Looking…" : first ? "Find pages to get onto" : "Look for new pages"}
      </button>
    </span>
  );
}

export function SkipButton({ id, skip }: { id: string; skip: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => skipTargetAction(id, skip))}
      className="text-xs text-fg-subtle hover:text-fg disabled:opacity-60"
    >
      {skip ? "Skip" : "Bring back"}
    </button>
  );
}

export function BriefButton({ promptId, again = false }: { promptId: string; again?: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => requestBriefAction(promptId))}
      className={again ? buttonSecondary : buttonPrimary}
    >
      <FileText className="size-3.5" />
      {pending ? "Starting…" : again ? "Write it again" : "Write a brief"}
    </button>
  );
}
