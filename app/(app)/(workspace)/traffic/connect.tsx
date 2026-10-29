"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Upload } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";
import { createSiteKeyAction, revokeSiteKeyAction } from "./actions";

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
      <pre className="max-h-72 overflow-auto rounded-lg bg-hover px-3 py-2 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

/** The same filter on every platform: AI agents' user agents, or a referral from an assistant. */
function snippets(endpoint: string, key: string, agents: string, referrers: string) {
  const report = (indent: string, fields: string) =>
    `${indent}fetch("${endpoint}", {\n${indent}  method: "POST",\n${indent}  headers: { "content-type": "application/json", authorization: "Bearer ${key}" },\n${indent}  body: JSON.stringify({ visits: [{ ${fields} }] }),\n${indent}})`;
  return {
    cloudflare: `// Cloudflare Worker in front of your site: reports AI visits, changes nothing else.
const AI = /${agents}/i;
const FROM_AI = /${referrers}/i;

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    const ua = request.headers.get("user-agent") || "";
    const referer = request.headers.get("referer") || "";
    const url = new URL(request.url);
    if (AI.test(ua) || FROM_AI.test(referer) || FROM_AI.test(url.search)) {
      ctx.waitUntil(
${report("        ", `at: Date.now(), ua, referer, ip: request.headers.get("cf-connecting-ip"), host: url.host, path: url.pathname + url.search, status: response.status`)},
      );
    }
    return response;
  },
};`,
    nextjs: `// middleware.ts (Next.js): reports AI visits in the background.
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const AI = /${agents}/i;
const FROM_AI = /${referrers}/i;

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const ua = request.headers.get("user-agent") || "";
  const referer = request.headers.get("referer") || "";
  if (AI.test(ua) || FROM_AI.test(referer) || FROM_AI.test(request.nextUrl.search)) {
    event.waitUntil(
${report("      ", `at: Date.now(), ua, referer, ip: request.headers.get("x-forwarded-for")?.split(",")[0], host: request.nextUrl.host, path: request.nextUrl.pathname + request.nextUrl.search`)}.catch(() => {}),
    );
  }
  return NextResponse.next();
}`,
    express: `// Express: add before your routes.
const AI = /${agents}/i;
const FROM_AI = /${referrers}/i;

app.use((req, res, next) => {
  const ua = req.get("user-agent") || "";
  const referer = req.get("referer") || "";
  if (AI.test(ua) || FROM_AI.test(referer) || FROM_AI.test(req.originalUrl)) {
    res.on("finish", () => {
${report("      ", `at: Date.now(), ua, referer, ip: req.ip, host: req.hostname, path: req.originalUrl, status: res.statusCode`)}.catch(() => {});
    });
  }
  next();
});`,
  };
}

export function ConnectSite({
  keys,
  endpoint,
  agents,
  referrers,
  canEdit,
}: {
  keys: { id: string; name: string; prefix: string; lastUsedAt: Date | null }[];
  endpoint: string;
  agents: string;
  referrers: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [created, setCreated] = useState<string | null>(null);
  const [tab, setTab] = useState<"cloudflare" | "nextjs" | "express">("cloudflare");
  const [upload, setUpload] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const code = snippets(endpoint, created ?? "ov_YOUR_SITE_KEY", agents, referrers);

  const send = (f: File) =>
    start(async () => {
      setUpload(`Reading ${f.name}…`);
      const res = await fetch("/api/ingest/logs", {
        method: "POST",
        body: f,
        headers: { "content-type": f.type || "text/plain", "x-file-name": f.name },
      });
      const r = await res.json();
      setUpload(
        res.ok
          ? `${r.lines.toLocaleString("en-US")} lines read: ${r.stored.toLocaleString("en-US")} AI visits added${r.duplicates ? `, ${r.duplicates.toLocaleString("en-US")} already here` : ""}${r.unreadable ? `, ${r.unreadable.toLocaleString("en-US")} lines in a format we don't read` : ""}.`
          : (r.error ?? "That didn't work."),
      );
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">Live, from your site</h3>
          <p className="text-xs text-fg-subtle">
            AI crawlers don&rsquo;t run JavaScript, so an analytics tag never sees them: a few lines
            on your server report each AI visit as it happens. Only AI crawler requests and visits
            from AI assistants are sent; everything else stays on your server. Googlebot, Bingbot
            and Applebot are left out here (they crawl constantly); log uploads include them.
          </p>
        </div>
        {created && (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--good)_30%,transparent)] bg-[color-mix(in_srgb,var(--good)_6%,transparent)] px-3 py-2 text-xs">
            Your site key is filled into the code below. Copy it now: it won&rsquo;t be shown again.
            It can only report visits.
          </p>
        )}
        {canEdit && !created && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createSiteKeyAction("Website");
                if (r.ok) setCreated(r.key);
                router.refresh();
              })
            }
            className={cn(buttonPrimary, "self-start")}
          >
            <KeyRound className="size-3.5" />
            Create a site key
          </button>
        )}
        <div className="flex gap-1 text-[13px]">
          {(
            [
              ["cloudflare", "Cloudflare Worker"],
              ["nextjs", "Next.js"],
              ["express", "Express"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-2.5 py-1",
                tab === id
                  ? "bg-inverted font-medium text-on-inverted"
                  : "text-fg-subtle hover:bg-hover",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <CopyBlock
          label={created ? "With your key" : "Create a site key to fill in your key"}
          text={code[tab]}
        />
        {keys.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span>
                  {k.name} · <code>{k.prefix}…</code> ·{" "}
                  {k.lastUsedAt
                    ? `last reported ${k.lastUsedAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`
                    : "nothing reported yet"}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      start(async () => void (await revokeSiteKeyAction(k.id), router.refresh()))
                    }
                    className="text-fg-subtle hover:text-bad"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">Or upload server logs</h3>
          <p className="text-xs text-fg-subtle">
            Nginx or Apache access logs (the usual &ldquo;combined&rdquo; format), or JSON lines
            from Cloudflare Logpush, Vercel and most hosts; gzipped is fine, up to 200 MB at a time.
            Only AI visits are kept, and uploading the same log twice counts it once.
          </p>
        </div>
        {canEdit && (
          <span className="flex flex-wrap items-center gap-3">
            <input
              ref={file}
              type="file"
              accept=".log,.txt,.json,.jsonl,.gz,text/plain,application/json,application/gzip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) send(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => file.current?.click()}
              className={buttonSecondary}
            >
              <Upload className="size-3.5" />
              {pending && upload?.startsWith("Reading") ? "Reading…" : "Upload a log file"}
            </button>
            {upload && <span className="text-xs text-fg-subtle">{upload}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
