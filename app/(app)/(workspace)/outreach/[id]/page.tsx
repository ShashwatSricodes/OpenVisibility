import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Mail } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/session";
import { footerOf, getSender, messagesOf, senderProblems } from "@/core/outreach/pitch";
import type { Contact } from "@/core/outreach/contacts";
import type { Research } from "@/core/outreach/research";
import type { Evidence } from "@/core/outreach/targets";
import { outreachTargets } from "@/db/schema";
import { getDb } from "@/db/client";
import { Page } from "../../../_components/page-frame";
import { AutoRefresh } from "../../runs/auto-refresh";
import { ApproveBar, MessageEditor } from "../review";

export const metadata: Metadata = { title: "Review email" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE: Record<string, string> = {
  draft: "Waiting for your approval",
  approved: "Approved: it goes out from your mailbox at the next send",
  sent: "Sent",
  failed: "Couldn't be sent",
  cancelled: "Not sent",
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [t] = await db
    .select()
    .from(outreachTargets)
    .where(and(eq(outreachTargets.workspaceId, workspace.id), eq(outreachTargets.id, id)))
    .limit(1);
  if (!t) notFound();
  const [{ pitch, followUp }, sender] = await Promise.all([
    messagesOf(db, workspace.id, id),
    getSender(db, workspace.id),
  ]);
  const research = t.research as Research | null;
  const contact = t.contact as Contact | null;
  const evidence = t.evidence as Evidence;
  const owner = role === "owner";
  const footer = footerOf(
    sender ?? {
      senderName: null,
      senderEmail: null,
      company: null,
      address: null,
      website: null,
      dailyCap: 10,
    },
  );
  const missing = senderProblems(sender);

  return (
    <Page
      title={t.title || t.domain}
      description={pitch ? STATE[pitch.status] : "Writing the email…"}
      width="narrow"
    >
      <AutoRefresh active={!pitch && t.status === "ready"} />
      <section className="flex flex-col gap-1 rounded-xl border border-line bg-panel p-4 text-[13px]">
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          {t.url}
          <ArrowUpRight className="size-3 text-fg-muted" />
        </a>
        {research && <span>{research.opening}</span>}
        {research && <span className="text-fg-subtle">{research.reason}</span>}
        <span className="text-xs text-fg-subtle">
          {evidence.ranks?.[0] &&
            `Ranks #${evidence.ranks[0].position} on Google for “${evidence.ranks[0].prompt}”. `}
          {evidence.answers > 0 &&
            `Cited in ${evidence.answers} AI ${evidence.answers === 1 ? "answer that leaves" : "answers that leave"} you out.`}
        </span>
        {contact && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            <Mail className="size-3.5 text-fg-muted" />
            <span className="font-medium">{contact.email}</span>
            <span className="text-fg-subtle">
              found on{" "}
              <a href={contact.foundOn} target="_blank" rel="noreferrer" className="underline">
                {contact.foundOn.replace(/^https?:\/\//, "")}
              </a>
            </span>
          </span>
        )}
      </section>

      {missing.length > 0 && owner && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
          Before approving: {missing.join(" ")}{" "}
          <Link href="/outreach/settings" className="underline underline-offset-2">
            Outreach settings
          </Link>
        </p>
      )}

      {pitch && (
        <>
          <MessageEditor m={pitch} label="Email" footer={footer} canEdit={owner} showTo />
          {followUp && (
            <MessageEditor
              m={followUp}
              label="Follow-up, a week later if there's no reply"
              footer={footer}
              canEdit={owner}
            />
          )}
          {owner && <ApproveBar targetId={t.id} status={pitch.status} />}
          <p className="text-xs text-fg-subtle">
            {pitch.source === "model"
              ? "Written by your analysis model from the page and your brand setup. Check every claim before approving."
              : "Written from a template, from the page and your brand setup. Edit it into your own words before approving."}
          </p>
        </>
      )}
    </Page>
  );
}
