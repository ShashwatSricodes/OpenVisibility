"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

type Key = {
  id: string;
  name: string;
  prefix: string;
  access: "read" | "write";
  createdAt: Date;
  lastUsedAt: Date | null;
};

const field =
  "h-8 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg outline-none focus:border-line-strong focus:ring-2 focus:ring-line disabled:opacity-60";
const day = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs text-fg-subtle">
        {label}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 hover:text-fg"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
      <pre className="overflow-x-auto rounded-lg bg-hover px-3 py-2 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

/** How to connect each client, with the new key filled in. */
function Connect({ endpoint, apiKey }: { endpoint: string; apiKey: string }) {
  return (
    <div className="flex flex-col gap-3">
      <CopyBlock
        label="Claude Code"
        text={`claude mcp add --transport http openvisibility ${endpoint} --header "Authorization: Bearer ${apiKey}"`}
      />
      <CopyBlock
        label="Cursor, Windsurf and other clients that take a URL (mcp.json)"
        text={JSON.stringify(
          {
            mcpServers: {
              openvisibility: { url: endpoint, headers: { Authorization: `Bearer ${apiKey}` } },
            },
          },
          null,
          2,
        )}
      />
      <CopyBlock
        label="Claude Desktop (claude_desktop_config.json): runs the relay from your OpenVisibility folder"
        text={JSON.stringify(
          {
            mcpServers: {
              openvisibility: {
                command: "npx",
                args: ["tsx", "/path/to/OpenVisibility/mcp/stdio.ts"],
                env: { OV_MCP_KEY: apiKey, OV_MCP_URL: endpoint },
              },
            },
          },
          null,
          2,
        )}
      />
    </div>
  );
}

export function ApiKeys({
  keys,
  endpoint,
  canEdit,
}: {
  keys: Key[];
  endpoint: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [created, setCreated] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      {created ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--good)_30%,transparent)] bg-[color-mix(in_srgb,var(--good)_6%,transparent)] p-3">
          <p className="text-[13px] font-medium">
            Your new key. Copy it now: it won&rsquo;t be shown again.
          </p>
          <CopyBlock label="API key" text={created} />
          <Connect endpoint={endpoint} apiKey={created} />
          <button
            type="button"
            onClick={() => setCreated(null)}
            className={cn(buttonSecondary, "self-start")}
          >
            Done
          </button>
        </div>
      ) : (
        canEdit && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await createApiKeyAction({ name, access });
                if (r.ok) {
                  setCreated(r.key);
                  setName("");
                  setMessage(null);
                } else setMessage(r.message);
                router.refresh();
              });
            }}
          >
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Desktop"
                className={cn(field, "w-56")}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium">Access</span>
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value as "read" | "write")}
                className={field}
              >
                <option value="read">Read only</option>
                <option value="write">Read and change (prompts, runs, audits)</option>
              </select>
            </label>
            <button type="submit" disabled={pending || !name.trim()} className={buttonPrimary}>
              <KeyRound className="size-3.5" />
              {pending ? "Creating…" : "Create key"}
            </button>
            {message && <span className="text-xs text-bad">{message}</span>}
          </form>
        )
      )}

      {keys.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {k.name}{" "}
                  <span className="text-xs font-normal text-fg-subtle">
                    · {k.access === "write" ? "read and change" : "read only"}
                  </span>
                </span>
                <span className="text-xs text-fg-subtle">
                  <code>{k.prefix}…</code> · created {day(k.createdAt)} ·{" "}
                  {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}
                </span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await revokeApiKeyAction(k.id);
                      router.refresh();
                    })
                  }
                  className="text-xs text-fg-subtle hover:text-bad"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">
        Endpoint: <code>{endpoint}</code>. Keys are stored only as a hash. Approving and sending
        outreach emails isn&rsquo;t possible with a key; that stays in the app.
      </p>
    </div>
  );
}
