import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Mail, Send, Settings2 } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { env } from "@/core/env";
import { getSender, senderProblems } from "@/core/outreach/pitch";
import { coverage, listTargets } from "@/core/outreach/targets";
import { searchStatus, TOP } from "@/core/search/serp";
import { ENGINES, isEngineId } from "@/core/providers/registry";
import { analysisModel } from "@/core/sentiment";
import { getDb } from "@/db/client";
import { EmptyState, Page, buttonSecondary } from "../../_components/page-frame";
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

/** Why it's on the list: where it ranks on Google, and the AI answers that cite it. */
function Why({ t }: { t: Target }) {
  const e = t.evidence;
  const engines = e.engines.filter(isEngineId).map((x) => ENGINES[x].name);
  const ranks = e.ranks ?? [];
  const best = ranks[0];
  const rankedFor = new Set(ranks.map((r) => r.prompt)).size;
  const rivals = e.rivals.length ? e.rivals : (t.research?.rivalsOnPage ?? []);
  return (
    <span className="flex flex-col text-xs text-fg-subtle">
      {best && (
        <span>
          <span className="font-medium text-fg">Ranks #{best.position} on Google</span> for “
          {best.prompt}”{rankedFor > 1 && ` and ${rankedFor - 1} more of your prompts`}
          {best.country && ` (${best.country})`}.
        </span>
      )}
      {e.answers > 0 && (
        <span>
          Cited in {e.answers} {e.answers === 1 ? "AI answer that names" : "AI answers that name"}{" "}
          {list(e.rivals.slice(0, 3))} but not you
          {engines.length > 0 && ` (${list(engines)})`}
          {!best && (
            <>
              , for “{e.prompts[0]}”{e.prompts.length > 1 && ` and ${e.prompts.length - 1} more`}
            </>
          )}
          .
        </span>
      )}
      {!e.answers && rivals.length > 0 && <span>Names {list(rivals.slice(0, 3))}, not you.</span>}
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
  const db = getDb();
  const [targets, cover, searched, sender] = await Promise.all([
    listTargets(db, workspace.id),
    coverage(db, workspace.id),
    searchStatus(db, workspace.id),
    getSender(db, workspace.id),
  ]);
  const senderMissing = senderProblems(sender);
  const searchOn = !!env().BRIGHT_DATA_SERP_ZONE || process.env.OV_FAKE_ANSWERS === "1";
  const owner = role === "owner";
  const by = (s: Target["status"]) => targets.filter((t) => t.status === s);
  const researching = by("found");
  const writing = by("ready");

  if (!targets.length)
    return (
      <Page title="Outreach" description="Getting onto the pages AI cites">
        <EmptyState
          icon={<Send />}
          title="Get onto the pages AI already trusts"
          description="The agent lists the top pages for your prompts that leave you out: those Google ranks highest and those AI answers cite. It reads each one, works out what mention would fit, and finds who to ask on the site itself. You approve every email before anything is sent."
        >
          {owner && <FindTargetsButton first />}
        </EmptyState>
      </Page>
    );

  return (
    <Page
      title="Outreach"
      description="The top pages for your prompts that leave you out, and who to ask"
      actions={
        <>
          <Link href="/outreach/settings" className={buttonSecondary}>
            <Settings2 className="size-3.5" />
            Settings
          </Link>
          {owner && <FindTargetsButton />}
        </>
      }
    >
      <AutoRefresh active={researching.length + writing.length > 0} everyMs={5_000} />
      {cover.total > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel px-4 py-3">
          <p className="text-[13px]">
            <span className="tabular text-lg font-semibold">
              {cover.covered + cover.yours} of {cover.total}
            </span>{" "}
            {cover.basis === "search"
              ? "top Google pages for your prompts mention you or are yours"
              : "pages AI cites for your prompts mention you"}
            {cover.pending > 0 && ` · ${cover.pending} still being read`}
          </p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <div
              className="bg-good"
              style={{ width: `${((cover.covered + cover.yours) / cover.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-fg-subtle">
            {process.env.OV_FAKE_ANSWERS === "1"
              ? "Development mode: the “Google” rankings here are a stand-in made from the pages AI cites, not real search results."
              : searchOn
                ? searched.last
                  ? `Google's top ${TOP} for each prompt, searched weekly; last on ${searched.last.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}.${searched.failing ? " Some searches are failing; they'll be tried again." : ""}`
                  : "Google results are on; the first searches run within a few minutes."
                : "Based on the pages AI cites. To include Google's top results for each prompt, set BRIGHT_DATA_SERP_ZONE to a Bright Data SERP API zone (same key)."}
          </p>
        </div>
      )}
      {!analysisModel() && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-xs text-fg-default">
          Research uses plain rules for now. With an analysis model set up (ANALYSIS_* in your
          environment; free tiers work), the agent reads each page and explains in its own words
          what&rsquo;s missing and why you belong there.
        </p>
      )}

      {owner && senderMissing.length > 0 && by("drafted").length > 0 && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
          Emails are waiting for you. Before you can approve them: {senderMissing.join(" ")}{" "}
          <Link href="/outreach/settings" className="underline underline-offset-2">
            Outreach settings
          </Link>
        </p>
      )}

      <Section
        title="To review"
        note="The agent wrote an email and a follow-up for each. Read, edit and approve them; nothing is sent until you do."
        items={by("drafted")}
        owner={owner}
        render={(t) => (
          <>
            {t.research && <span>{t.research.opening}</span>}
            <Link
              href={`/outreach/${t.id}`}
              className="mt-1 self-start text-[13px] font-medium underline underline-offset-2"
            >
              Review the email to {t.contact?.email}
            </Link>
          </>
        )}
      />

      <Section
        title="Approved"
        note="Approved by you; they go out from your mailbox once sending is set up, within your daily limit."
        items={by("approved")}
        owner={owner}
        render={(t) => (
          <Link
            href={`/outreach/${t.id}`}
            className="self-start text-xs underline underline-offset-2"
          >
            To {t.contact?.email}: view or take back
          </Link>
        )}
      />

      <Section
        title="Writing the email"
        note="Researched, with a published address to write to; the email draft is on its way."
        items={writing}
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
