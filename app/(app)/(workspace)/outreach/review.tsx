"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Undo2, X } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";
import {
  approveAction,
  blockAction,
  saveMessageAction,
  saveSenderAction,
  skipPitchAction,
  unapproveAction,
  unblockAction,
} from "./actions";

const field =
  "w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-fg outline-none focus:border-line-strong focus:ring-2 focus:ring-line disabled:opacity-60";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; problems?: string[] }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.message ?? null);
      setProblems(r.problems ?? []);
      router.refresh();
    });
  return { pending, message, problems, run };
}

/* ── sender details ───────────────────────────────────────── */

export type SenderForm = {
  senderName: string;
  senderEmail: string;
  company: string;
  address: string;
  website: string;
  dailyCap: number;
};

export function SenderSettings({ initial, canEdit }: { initial: SenderForm; canEdit: boolean }) {
  const [f, setF] = useState(initial);
  const { pending, message, run } = useRun();
  const set =
    (k: keyof SenderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: k === "dailyCap" ? Number(e.target.value) : e.target.value });
  const row = (label: string, k: keyof SenderForm, hint?: string, area = false) => (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium">{label}</span>
      {area ? (
        <textarea
          rows={3}
          value={String(f[k])}
          onChange={set(k)}
          disabled={!canEdit}
          className={field}
        />
      ) : (
        <input value={String(f[k])} onChange={set(k)} disabled={!canEdit} className={field} />
      )}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSenderAction(f));
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {row("Your name", "senderName", "Emails are signed with it.")}
        {row("Send from", "senderEmail", "The mailbox emails go out from.")}
        {row("Company", "company")}
        {row("Website", "website")}
      </div>
      {row(
        "Postal address",
        "address",
        "Every email shows it, with an opt-out line: anti-spam law (CAN-SPAM) requires both.",
        true,
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">At most</span>
        <input
          type="number"
          min={1}
          max={50}
          value={f.dailyCap}
          onChange={set("dailyCap")}
          disabled={!canEdit}
          className={cn(field, "w-20")}
        />
        <span className="text-fg-subtle">emails a day</span>
      </label>
      {canEdit && (
        <span className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? "Saving…" : "Save"}
          </button>
          {message && <span className="text-xs text-fg-subtle">{message}</span>}
        </span>
      )}
    </form>
  );
}

/* ── do-not-contact list ──────────────────────────────────── */

export function DoNotContact({
  items,
  canEdit,
}: {
  items: { id: string; value: string; reason: string | null }[];
  canEdit: boolean;
}) {
  const [value, setValue] = useState("");
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await blockAction(value);
              if (r.ok) setValue("");
              return r;
            });
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="name@site.com or site.com"
            aria-label="Address or domain"
            className={cn(field, "max-w-xs")}
          />
          <button type="submit" disabled={pending || !value.trim()} className={buttonSecondary}>
            Add
          </button>
        </form>
      )}
      {message && <span className="text-xs text-fg-subtle">{message}</span>}
      {items.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          Nobody yet. People who reply “unsubscribe” are added automatically.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]"
            >
              <span>
                {i.value}
                {i.reason && <span className="text-xs text-fg-subtle"> · {i.reason}</span>}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => run(() => unblockAction(i.id))}
                  className="text-xs text-fg-subtle hover:text-fg"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── one email ────────────────────────────────────────────── */

type Message = {
  id: string;
  status: string;
  to: string;
  subject: string;
  body: string;
};

export function MessageEditor({
  m,
  label,
  footer,
  canEdit,
  showTo = false,
}: {
  m: Message;
  label: string;
  footer: string;
  canEdit: boolean;
  showTo?: boolean;
}) {
  const [to, setTo] = useState(m.to);
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const { pending, message, run } = useRun();
  const editable = canEdit && (m.status === "draft" || m.status === "approved");
  const dirty = to !== m.to || subject !== m.subject || body !== m.body;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">{label}</h2>
      {showTo && (
        <label className="flex items-center gap-2 text-[13px]">
          <span className="w-16 text-fg-subtle">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={!editable}
            className={field}
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <span className="w-16 text-fg-subtle">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={!editable}
          className={field}
        />
      </label>
      <textarea
        rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!editable}
        aria-label={`${label} text`}
        className={cn(field, "font-[inherit] leading-relaxed")}
      />
      <pre className="whitespace-pre-wrap rounded-lg bg-hover px-3 py-2 font-sans text-xs text-fg-subtle">
        {footer}
      </pre>
      {editable && (
        <span className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() => run(() => saveMessageAction(m.id, { to, subject, body }))}
            className={buttonSecondary}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          {message && <span className="text-xs text-fg-subtle">{message}</span>}
        </span>
      )}
    </section>
  );
}

/* ── approve, take back, skip ─────────────────────────────── */

export function ApproveBar({ targetId, status }: { targetId: string; status: string }) {
  const { pending, message, problems, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        {status === "draft" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveAction(targetId))}
            className={buttonPrimary}
          >
            <Check className="size-3.5" />
            Approve both emails
          </button>
        ) : status === "approved" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unapproveAction(targetId))}
            className={buttonSecondary}
          >
            <Undo2 className="size-3.5" />
            Take back approval
          </button>
        ) : null}
        {(status === "draft" || status === "approved") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => skipPitchAction(targetId))}
            className={buttonSecondary}
          >
            <X className="size-3.5" />
            Skip this site
          </button>
        )}
        {message && <span className="text-xs text-fg-subtle">{message}</span>}
      </span>
      {problems.length > 0 && (
        <ul role="alert" className="ml-4 list-disc text-xs text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
