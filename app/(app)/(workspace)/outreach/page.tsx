import type { Metadata } from "next";
import { ArrowUpRight, Mail, Send } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { listTargets } from "@/core/outreach/targets";
import { ENGINES, isEngineId } from "@/core/providers/registry";
import { analysisModel } from "@/core/sentiment";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { AutoRefresh } from "../runs/auto-refresh";
import { FindTargetsButton, SkipButton } from "./buttons";

export const metadata: Metadata = { title: "Outreach" };

type Target = Awaited<ReturnType<typeof listTargets>>[number];

const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};
const list = (xs: string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

const ROLE = { author: "the author", editorial: "editorial desk", general: "general inbox" };

function Why({ t }: { t: Target }) {
  const engines = t.evidence.engines.filter(isEngineId).map((e) => ENGINES[e].name);
  return (
    <span className="text-xs text-fg-subtle">
      Cited in {t.evidence.answers}{" "}
      {t.evidence.answers === 1 ? "answer that names" : "answers that name"}{" "}
      {list(t.evidence.rivals.slice(0, 3))} but not you
      {engines.length > 0 && ` (${list(engines)})`}, for “{t.evidence.prompts[0]}”
      {t.evidence.prompts.length > 1 && ` and ${t.evidence.prompts.length - 1} more`}.
    </span>
  );
}

function Row({ t, owner, children }: { t: Target; owner: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-[13px]">
      <span className="flex items-start justify-between gap-3">
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1 font-medium hover:underline"
        >
          <span className="truncate">{t.title || shortUrl(t.url)}</span>
          <ArrowUpRight className="size-3 shrink-0 text-fg-muted" />
        </a>
        {owner && <SkipButton id={t.id} skip={t.status !== "skipped"} />}
      </span>
      {t.title && <span className="truncate text-xs text-fg-subtle">{shortUrl(t.url)}</span>}
      <Why t={t} />
      {children}
    </li>
  );
}

function Section({
  title,
  note,
  items,
  owner,
  render,
}: {
  title: string;
  note: string;
  items: Target[];
  owner: boolean;
  render?: (t: Target) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">
          {title} <span className="tabular font-normal text-fg-subtle">{items.length}</span>
        </h2>
        <p className="text-xs text-fg-subtle">{note}</p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
        {items.map((t) => (
          <Row key={t.id} t={t} owner={owner}>
            {render?.(t)}
          </Row>
        ))}
      </ul>
    </section>
  );
}

export default async function OutreachPage() {
  const { workspace, role } = await requireWorkspace();
  const targets = await listTargets(getDb(), workspace.id);
  const owner = role === "owner";
  const by = (s: Target["status"]) => targets.filter((t) => t.status === s);
  const researching = by("found");

  if (!targets.length)
    return (
      <Page title="Outreach" description="Getting onto the pages AI cites">
        <EmptyState
          icon={<Send />}
          title="Get onto the pages AI already trusts"
          description="The agent lists the pages AI cites for your prompts when it names competitors but not you, reads each one, works out what mention would fit, and finds who to ask on the site itself. You approve every email before anything is sent."
        >
          {owner && <FindTargetsButton first />}
        </EmptyState>
      </Page>
    );

  return (
    <Page
      title="Outreach"
      description="Pages AI cites for your prompts that leave you out, and who to ask"
      actions={owner ? <FindTargetsButton /> : undefined}
    >
      <AutoRefresh active={researching.length > 0} everyMs={5_000} />
      {!analysisModel() && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-xs text-fg-default">
          Research uses plain rules for now. With an analysis model set up (ANALYSIS_* in your
          environment; free tiers work), the agent reads each page and explains in its own words
          what&rsquo;s missing and why you belong there.
        </p>
      )}

      <Section
        title="Ready to pitch"
        note="Researched, with a published address to write to. Nothing is sent without your approval."
        items={by("ready")}
        owner={owner}
        render={(t) => (
          <>
            {t.research && (
              <>
                <span>{t.research.opening}</span>
                <span className="text-fg-subtle">{t.research.reason}</span>
              </>
            )}
            {t.contact && (
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                <Mail className="size-3.5 text-fg-muted" />
                <span className="font-medium">{t.contact.email}</span>
                <span className="text-fg-subtle">
                  {t.contact.name ? `${t.contact.name}, ` : ""}
                  {ROLE[t.contact.role]} · found on{" "}
                  <a
                    href={t.contact.foundOn}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {shortUrl(t.contact.foundOn)}
                  </a>
                </span>
              </span>
            )}
          </>
        )}
      />

      <Section
        title="For you to do"
        note="Review platforms, directories and forums: you list yourself or join the conversation; there's no one to pitch."
        items={by("task")}
        owner={owner}
        render={(t) => <span>{t.note}</span>}
      />

      <Section
        title="Researching"
        note="The agent reads a couple of pages at a time; this page updates as it goes."
        items={researching}
        owner={owner}
      />

      <Section
        title="No public contact"
        note="Researched, but the site publishes no address to write to."
        items={by("no_contact")}
        owner={owner}
        render={(t) => (
          <>
            {t.research && <span>{t.research.opening}</span>}
            <span className="text-xs text-fg-subtle">{t.note}</span>
          </>
        )}
      />

      {by("skipped").length > 0 && (
        <details className="rounded-xl border border-line bg-panel">
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-fg-subtle">
            {by("skipped").length} set aside
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {by("skipped").map((t) => (
              <Row key={t.id} t={t} owner={owner}>
                <span className="text-xs text-fg-subtle">{t.note}</span>
              </Row>
            ))}
          </ul>
        </details>
      )}
    </Page>
  );
}
