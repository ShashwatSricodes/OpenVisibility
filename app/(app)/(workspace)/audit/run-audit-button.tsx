"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, ScanSearch } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../../_components/page-frame";
import { runAuditAction } from "./actions";

export function RunAuditButton({ again = false }: { again?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={pending}
        className={again ? buttonSecondary : buttonPrimary}
        onClick={() =>
          start(async () => {
            const r = await runAuditAction();
            setMessage(r.ok ? null : r.message);
            router.refresh();
          })
        }
      >
        {again ? <RotateCw className="size-3.5" /> : <ScanSearch className="size-3.5" />}
        {pending ? "Starting…" : again ? "Run again" : "Run the audit"}
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
