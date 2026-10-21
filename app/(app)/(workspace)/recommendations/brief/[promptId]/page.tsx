import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/session";
import { getBrief } from "@/core/outreach/brief";
import { brands, prompts } from "@/db/schema";
import { getDb } from "@/db/client";
import { Page } from "../../../../_components/page-frame";
import { AutoRefresh } from "../../../runs/auto-refresh";
import { BriefButton } from "../../../outreach/buttons";

export const metadata: Metadata = { title: "Content brief" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function BriefPage({ params }: { params: Promise<{ promptId: string }> }) {
  const { promptId } = await params;
  if (!UUID.test(promptId)) notFound();
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [prompt] = await db
    .select({ text: prompts.text })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .where(and(eq(prompts.id, promptId), eq(brands.workspaceId, workspace.id)))
    .limit(1);
  if (!prompt) notFound();
  const row = await getBrief(db, workspace.id, promptId);
  const working = row?.status === "queued" || row?.status === "running";
  const b = row?.status === "done" ? row.brief : null;
  const owner = role === "owner";

  return (
    <Page
      title="Content brief"
      description={`What a page needs to be cited for “${prompt.text}”`}
      width="narrow"
      actions={owner && b ? <BriefButton promptId={promptId} again /> : undefined}
    >
      <AutoRefresh active={working} />
      {!row ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-panel p-4 text-[13px]">
          <p>
            The brief is built from the pages AI cites for this prompt today: how long they are, the
            questions their headings answer, the formats they use, and the sites they come from.
          </p>
          {owner && <BriefButton promptId={promptId} />}
        </div>
      ) : working ? (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
          Reading the pages AI cites for this prompt…
        </p>
      ) : !b || !b.pages.length ? (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
          No cited pages from other sites could be read for this prompt in the last 90 days, so
          there&rsquo;s nothing to build a brief from yet.
        </p>
      ) : (
        <div className="flex flex-col gap-5 rounded-xl border border-line bg-panel p-5 text-[13px]">
          {b.title && (
            <Part title="Suggested title">
              <p className="text-base font-medium">{b.title}</p>
              {b.angle && <p className="text-fg-subtle">{b.angle}</p>}
            </Part>
          )}
          {b.outline && b.outline.length > 0 && (
            <Part title="Outline">
              <ol className="ml-5 list-decimal">
                {b.outline.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            </Part>
          )}
          <Part title="Length">
            <p>About {b.words.toLocaleString("en-US")} words, like the pages cited now.</p>
          </Part>
          {b.questions.length > 0 && (
            <Part title="Questions to answer">
              <p className="text-xs text-fg-subtle">
                The cited pages&rsquo; headings answer these; give each its own heading and a
                straight answer under it.
              </p>
              <ul className="ml-5 list-disc">
                {b.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Part>
          )}
          {b.formats.length > 0 && (
            <Part title="Include">
              <ul className="ml-5 list-disc">
                {b.formats.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Part>
          )}
          <Part title="Sites to earn a mention on">
            <p className="text-xs text-fg-subtle">
              AI cites these for this prompt; a mention there helps as much as your own page.
            </p>
            <p>{b.sources.join(", ")}</p>
          </Part>
          <Part title="Based on">
            <ul className="flex flex-col gap-1">
              {b.pages.map((p) => (
                <li key={p.url}>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    {p.title || p.url}
                    <ArrowUpRight className="size-3 text-fg-muted" />
                  </a>
                  <span className="tabular text-xs text-fg-subtle">
                    {" "}
                    · {p.words.toLocaleString("en-US")} words
                  </span>
                </li>
              ))}
            </ul>
          </Part>
          {b.source === "rules" && (
            <p className="text-xs text-fg-subtle">
              With an analysis model set up, the brief also suggests a title, an angle and an
              outline.
            </p>
          )}
        </div>
      )}
    </Page>
  );
}
