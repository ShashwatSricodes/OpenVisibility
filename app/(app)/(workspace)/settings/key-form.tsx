"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Server } from "lucide-react";
import { cn } from "../../_lib/cn";
import { removeKeyAction, saveKeyAction, testKeyAction, type KeyFormState } from "./actions";

export type KeyStatus =
  | { kind: "workspace"; last4: string; addedAt: string; verifiedAt: string | null }
  | { kind: "server" }
  | { kind: "none" };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const button =
  "flex h-8 items-center justify-center rounded-lg border border-line px-3 text-[13px] font-medium text-fg-default transition-colors hover:bg-hover disabled:opacity-60";

function StatusRow({ status }: { status: KeyStatus }) {
  if (status.kind === "workspace")
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-pressed">
          <KeyRound className="size-4 text-fg-default" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium">
            Your key <span className="font-mono text-fg-subtle">••••{status.last4}</span>
          </p>
          <p className="text-xs text-fg-subtle" suppressHydrationWarning>
            Added {day(status.addedAt)}
            {status.verifiedAt ? ` · last tested ${day(status.verifiedAt)}` : " · not tested"}
          </p>
        </div>
      </div>
    );
  if (status.kind === "server")
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-pressed">
          <Server className="size-4 text-fg-default" />
        </span>
        <div>
          <p className="text-[13px] font-medium">Using the server&rsquo;s key</p>
          <p className="text-xs text-fg-subtle">
            Set by whoever runs this server (BRIGHT_DATA_API_KEY). Add your own key to use your own
            Bright Data account.
          </p>
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-pressed">
        <CircleAlert className="size-4 text-bad" />
      </span>
      <div>
        <p className="text-[13px] font-medium">No key yet</p>
        <p className="text-xs text-fg-subtle">Add a key before your first tracking run.</p>
      </div>
    </div>
  );
}

export function BrightDataKeyForm({ status, canEdit }: { status: KeyStatus; canEdit: boolean }) {
  const [key, setKey] = useState("");
  const [result, setResult] = useState<KeyFormState>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);

  const run = (which: typeof busy, action: () => Promise<KeyFormState>) =>
    start(async () => {
      setBusy(which);
      setResult(null);
      const r = await action();
      setResult(r);
      if (which === "save" && r?.ok) setKey("");
      setBusy(null);
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const form = new FormData();
    form.set("key", key);
    run("save", () => saveKeyAction(null, form));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <StatusRow status={status} />
        <div className="flex shrink-0 gap-2">
          {status.kind !== "none" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("test", testKeyAction)}
              className={button}
            >
              {busy === "test" ? "Testing…" : "Test"}
            </button>
          )}
          {status.kind === "workspace" && canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("Remove this key? Runs will stop until a key is added again."))
                  run("remove", removeKeyAction);
              }}
              className={cn(button, "text-bad")}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>

      {canEdit ? (
        <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="bright-data-key">
            Bright Data API key
          </label>
          <input
            id="bright-data-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              status.kind === "workspace" ? "Paste a new key to replace it" : "Paste your API key"
            }
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 font-mono text-[13px] text-fg outline-none transition-colors placeholder:font-sans placeholder:text-fg-muted focus:border-line-strong focus:ring-2 focus:ring-line"
          />
          <button
            type="submit"
            disabled={pending || !key.trim()}
            className="flex h-8 items-center justify-center rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy === "save" ? "Checking key…" : "Save and test"}
          </button>
        </form>
      ) : (
        <p className="text-xs text-fg-subtle">Only the workspace owner can change the key.</p>
      )}

      {result && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1.5 text-[13px]",
            result.ok ? "text-good" : "text-bad",
          )}
        >
          {result.ok ? (
            <CheckCircle2 className="size-3.5 shrink-0" />
          ) : (
            <CircleAlert className="size-3.5 shrink-0" />
          )}
          {result.message}
        </p>
      )}
    </div>
  );
}
