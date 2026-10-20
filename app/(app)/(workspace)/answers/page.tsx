import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageSquareText, Search } from "lucide-react";
import { archiveOptions, listAnswers, type ArchiveFilter } from "@/core/answer-archive";
import { requireWorkspace } from "@/core/auth/session";
import { countryName } from "@/core/countries";
import { ENGINES, isEngineId } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { EmptyState, Page, buttonSecondary } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";

export const metadata: Metadata = { title: "Answers" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

const field =
  "h-8 rounded-lg border border-line bg-panel px-2 text-[13px] text-fg outline-none focus:border-line-strong";

export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const q = await searchParams;
  const engine = one(q.engine);
  const filter: ArchiveFilter = {
    engine: engine && isEngineId(engine) ? engine : undefined,
    promptId: UUID.test(one(q.prompt) ?? "") ? one(q.prompt) : undefined,
    country: /^[A-Z]{2}$/.test(one(q.country) ?? "") ? one(q.country) : undefined,
    runId: UUID.test(one(q.run) ?? "") ? one(q.run) : undefined,
    named:
      one(q.named) === "yes" || one(q.named) === "no" ? (one(q.named) as "yes" | "no") : undefined,
    q: one(q.q),
    page: Number(one(q.page)) || 1,
  };
  const [list, options] = await Promise.all([
    listAnswers(db, workspace.id, filter),
    archiveOptions(db, workspace.id),
  ]);
  const filtered = Object.entries(filter).some(([k, v]) => k !== "page" && v);

  // the same filters, another page
  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q))
      if (typeof v === "string" && v && k !== "page") p.set(k, v);
    if (page > 1) p.set("page", String(page));
    return `/answers${p.size ? `?${p}` : ""}`;
  };

  if (!options.runs.length)
    return (
      <Page title="Answers" description="Every answer the engines gave, word for word">
        <EmptyState
          icon={<MessageSquareText />}
          title="No answers yet"
          description="After your first run, every answer is kept here: the full text from each engine, which brands it names, and the sources it cites."
          action={{ href: "/runs", label: "See runs" }}
        />
      </Page>
    );

  return (
    <Page
      title="Answers"
      description={`${list.total.toLocaleString("en-US")} ${filtered ? "matching " : ""}${list.total === 1 ? "answer" : "answers"}, newest first`}
    >
      <form method="get" className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-fg-muted" />
          <input
            type="search"
            name="q"
            defaultValue={filter.q}
            placeholder="Search answers and prompts"
            aria-label="Search"
            className={cn(field, "w-60 pl-8")}
          />
        </span>
        <select
          name="named"
          defaultValue={filter.named ?? ""}
          aria-label="Names you"
          className={field}
        >
          <option value="">Any answer</option>
          <option value="yes">Names you</option>
          <option value="no">Doesn&rsquo;t name you</option>
        </select>
        <select
          name="engine"
          defaultValue={filter.engine ?? ""}
          aria-label="Engine"
          className={field}
        >
          <option value="">All engines</option>
          {options.engines.map((e) => (
            <option key={e} value={e}>
              {ENGINES[e].name}
            </option>
          ))}
        </select>
        {options.countries.length > 1 && (
          <select
            name="country"
            defaultValue={filter.country ?? ""}
            aria-label="Country"
            className={field}
          >
            <option value="">All countries</option>
            {options.countries.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
        )}
        <select
          name="prompt"
          defaultValue={filter.promptId ?? ""}
          aria-label="Prompt"
          className={cn(field, "max-w-64")}
        >
          <option value="">All prompts</option>
          {options.prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.text}
            </option>
          ))}
        </select>
        <select name="run" defaultValue={filter.runId ?? ""} aria-label="Run" className={field}>
          <option value="">All runs</option>
          {options.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {when(r.at)} UTC{r.trigger === "scheduled" ? " · scheduled" : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-8 rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted"
        >
          Filter
        </button>
        {filtered && (
          <Link href="/answers" className="text-[13px] text-fg-subtle hover:text-fg">
            Clear
          </Link>
        )}
      </form>

      {list.rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-[13px] text-fg-subtle">
          No answers match these filters.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line bg-panel">
          {list.rows.map((a) => (
            <Link
              key={a.id}
              href={`/answers/${a.id}`}
              className="flex flex-col gap-1 px-4 py-3 hover:bg-hover"
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                <span className="font-medium text-fg">{ENGINES[a.engine].name}</span>
                {a.country && <span>{countryName(a.country)}</span>}
                <span>{when(a.at)}</span>
                {a.reused && <span className="rounded bg-pressed px-1.5 py-px">Reused</span>}
                <span
                  className={cn(
                    "rounded px-1.5 py-px",
                    a.namesYou
                      ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] font-medium text-good"
                      : "bg-pressed",
                  )}
                >
                  {a.namesYou ? "Names you" : "Doesn’t name you"}
                </span>
                {a.named.filter(Boolean).length > 0 && (
                  <span className="truncate">also {a.named.filter(Boolean).join(", ")}</span>
                )}
              </span>
              <span className="text-[13px] font-medium">{a.prompt}</span>
              <span className="line-clamp-2 text-[13px] text-fg-default">{a.excerpt}</span>
            </Link>
          ))}
        </div>
      )}

      {list.pages > 1 && (
        <nav className="flex items-center justify-between text-[13px]">
          {list.page > 1 ? (
            <Link href={pageHref(list.page - 1)} className={buttonSecondary}>
              <ChevronLeft className="size-3.5" />
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-fg-subtle">
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages ? (
            <Link href={pageHref(list.page + 1)} className={buttonSecondary}>
              Older
              <ChevronRight className="size-3.5" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </Page>
  );
}
