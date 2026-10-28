/**
 * Pitches: one short email per target and one follow-up, drafted by the
 * agent and approved by a person. Nothing here sends; sending (Day O3)
 * only ever picks up messages a person approved.
 *
 * The editable part is the greeting and the pitch. The sender block, the
 * postal address and the opt-out line are added when the email is sent
 * (footerOf), so they can't be edited away: CAN-SPAM requires an address and
 * a working opt-out in commercial email, and they're simply good manners.
 */

import { Output, generateText } from "ai";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyDb } from "@/db/client";
import { doNotContact, outreachMessages, outreachSettings, outreachTargets } from "@/db/schema";
import type { AnalysisModel } from "../sentiment";
import type { Contact } from "./contacts";
import type { Brand, Research } from "./research";
import { brandOf, type Evidence } from "./targets";

export const FOLLOW_UP_DAYS = 7;
/** Left in drafts written before the sender's name was known; filled in when it's saved. */
export const NAME_PLACEHOLDER = "[your name]";
export const MAX_SUBJECT = 120;
export const MAX_BODY = 2_000;

export type Sender = {
  senderName: string | null;
  senderEmail: string | null;
  company: string | null;
  address: string | null;
  website: string | null;
  dailyCap: number;
};

export type Draft = { subject: string; body: string };
export type Pitch = {
  pitch: Draft;
  followUp: Draft;
  source: "model" | "template";
  costUsd: number;
};

type TargetFacts = {
  url: string;
  domain: string;
  title: string | null;
  research: Research;
  contact: Contact;
  evidence: Evidence;
};

const list = (xs: string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/** What the brand is, in a phrase, from its setup only. */
function whatItIs(brand: Brand) {
  const what = brand.description ?? (brand.category ? `${brand.category}` : null);
  return [what, brand.audience && `for ${brand.audience}`].filter(Boolean).join(", ");
}

/** The template version: plain, specific to the page, never claiming more than the setup says. */
export function draftByTemplate(t: TargetFacts, brand: Brand, sender: Sender): Pitch {
  const page = t.title ? `“${t.title}”` : `your page on ${t.domain}`;
  const rivals = t.research.rivalsOnPage?.length ? t.research.rivalsOnPage : t.evidence.rivals;
  const covers = rivals.length
    ? `It covers ${list(rivals.slice(0, 3))}, but not ${brand.name}.`
    : "";
  const ask = {
    list: `Would you consider adding ${brand.name} to the list?`,
    comparison: `Would you consider including ${brand.name} in the comparison?`,
    review: `Would you consider reviewing ${brand.name}?`,
    article: `Would you consider mentioning ${brand.name} the next time you update it?`,
    directory: `Would you consider listing ${brand.name}?`,
    community: `Would you consider mentioning ${brand.name}?`,
  }[t.research.kind];
  const what = whatItIs(brand);
  const greeting = `Hi ${firstName(t.contact.name) ?? "there"},`;
  // without a sender name yet, a placeholder that blocks approval until it's filled in
  const signoff = `Thanks,\n${firstName(sender.senderName) ?? NAME_PLACEHOLDER}`;
  const subjects = {
    list: `${brand.name} for ${t.title ? `“${t.title}”` : "your list"}`,
    comparison: `${brand.name} for your comparison`,
    review: `${brand.name}: worth a review?`,
    article: `${brand.name}, for ${t.title ? `“${t.title}”` : "your article"}`,
    directory: `Listing ${brand.name}`,
    community: `${brand.name}`,
  };
  return {
    pitch: {
      subject: subjects[t.research.kind].slice(0, MAX_SUBJECT),
      body: [
        greeting,
        `I read ${page}. ${covers}`.trim(),
        `${brand.name}${what ? ` is ${what}` : ""}. If it's useful to your readers, I'm happy to send details, screenshots or an account to try it yourself.`,
        ask,
        signoff,
      ].join("\n\n"),
    },
    followUp: {
      subject: `Re: ${subjects[t.research.kind]}`.slice(0, MAX_SUBJECT),
      body: [
        greeting,
        `Following up on my note about ${brand.name} and ${page}. Happy to send anything that helps, and if it's not a fit, no worries at all.`,
        signoff,
      ].join("\n\n"),
    },
    source: "template",
    costUsd: 0,
  };
}

const schema = z.object({
  subject: z.string().describe("short and specific to the page, no clickbait, under 80 characters"),
  body: z
    .string()
    .describe(
      "the email from the greeting to the sign-off with the sender's first name; under 120 words; no links; no address or unsubscribe line (added later)",
    ),
  followUpBody: z
    .string()
    .describe("a two- or three-sentence polite follow-up sent a week later if there's no reply"),
});

export function pitchPrompt(t: TargetFacts, brand: Brand, sender: Sender) {
  return [
    "Write a short outreach email asking a website to mention a company on one of its pages.",
    "Rules: be specific to the page; be brief and polite; one clear ask; no flattery beyond one honest line; no links; no attachments; no pressure or urgency; never invent features, prices, awards, customers or numbers. Use only the facts below.",
    "",
    `Company: ${brand.name}${brand.description ? `, ${brand.description}` : ""}${brand.category ? ` (${brand.category})` : ""}${brand.audience ? `, for ${brand.audience}` : ""}.`,
    `Sender: ${sender.senderName ?? "the sender"}${sender.company ? ` at ${sender.company}` : ""}.`,
    `Recipient: ${t.contact.name ?? `the ${t.contact.role === "editorial" ? "editors" : "team"} at ${t.domain}`}.`,
    `Page: ${t.title ?? t.url} (${t.url}), a ${t.research.kind}.`,
    `What's missing: ${t.research.opening}`,
    `Why it fits: ${t.research.reason}`,
  ].join("\n");
}

export async function draftByModel(
  m: AnalysisModel,
  t: TargetFacts,
  brand: Brand,
  sender: Sender,
): Promise<Pitch | null> {
  try {
    const result = await generateText({
      model: m.model,
      output: Output.object({ schema }),
      prompt: pitchPrompt(t, brand, sender),
    });
    const { inputTokens = 0, outputTokens = 0 } = result.usage;
    const o = result.output;
    return {
      pitch: { subject: o.subject.slice(0, MAX_SUBJECT), body: o.body.slice(0, MAX_BODY) },
      followUp: {
        subject: `Re: ${o.subject}`.slice(0, MAX_SUBJECT),
        body: o.followUpBody.slice(0, MAX_BODY),
      },
      source: "model",
      costUsd: (inputTokens * m.priceInput + outputTokens * m.priceOutput) / 1_000_000,
    };
  } catch {
    return null;
  }
}

/** The fixed end of every email: who it's from, the postal address, and how to opt out. */
export function footerOf(s: Sender) {
  return [
    "--",
    [s.senderName, s.company].filter(Boolean).join(", "),
    s.website,
    s.address,
    `Not interested? Reply "unsubscribe" and we won't email you again.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── checks ───────────────────────────────────────────────── */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What's missing from the sender details before anything can be approved. */
export function senderProblems(s: Sender | null): string[] {
  if (!s) return ["Add your name, email and company's postal address in outreach settings."];
  const out: string[] = [];
  if (!s.senderName?.trim()) out.push("Add the sender's name.");
  if (!s.senderEmail || !EMAIL.test(s.senderEmail)) out.push("Add the email address to send from.");
  if (!s.address?.trim()) out.push("Add your company's postal address; every email must show one.");
  return out;
}

export function isBlocked(email: string, blocked: string[]) {
  const e = email.toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return blocked.some((b) => {
    const v = b.toLowerCase();
    return v.includes("@") ? v === e : domain === v || domain.endsWith(`.${v}`);
  });
}

/** Why a message can't be approved as it stands; empty when it can. */
export function messageProblems(
  m: { to: string; subject: string; body: string },
  blocked: string[],
): string[] {
  const out: string[] = [];
  if (!EMAIL.test(m.to)) out.push("The recipient's address isn't valid.");
  else if (isBlocked(m.to, blocked))
    out.push("This address or its domain is on your do-not-contact list.");
  if (!m.subject.trim()) out.push("Add a subject.");
  if (m.subject.length > MAX_SUBJECT) out.push(`Keep the subject under ${MAX_SUBJECT} characters.`);
  if (!m.body.trim()) out.push("The email is empty.");
  if (m.body.length > MAX_BODY) out.push(`Keep the email under ${MAX_BODY} characters.`);
  if (/\{\{|\}\}|\[(name|first name|company|your name)\]/i.test(`${m.subject}\n${m.body}`))
    out.push("Fill in the placeholder left in the text.");
  return out;
}

/* ── storage ──────────────────────────────────────────────── */

export async function getSender(db: AnyDb, workspaceId: string): Promise<Sender | null> {
  const [row] = await db
    .select()
    .from(outreachSettings)
    .where(eq(outreachSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function saveSender(
  db: AnyDb,
  workspaceId: string,
  s: Omit<Sender, "dailyCap"> & { dailyCap?: number },
) {
  const clean = {
    senderName: s.senderName?.trim() || null,
    senderEmail: s.senderEmail?.trim().toLowerCase() || null,
    company: s.company?.trim() || null,
    address: s.address?.trim() || null,
    website: s.website?.trim() || null,
    dailyCap: Math.max(1, Math.min(50, Math.round(s.dailyCap ?? 10))),
    updatedAt: new Date(),
  };
  await db
    .insert(outreachSettings)
    .values({ workspaceId, ...clean })
    .onConflictDoUpdate({ target: outreachSettings.workspaceId, set: clean });
  // drafts written before the name was known get it now
  const first = firstName(clean.senderName);
  if (first)
    await db
      .update(outreachMessages)
      .set({
        body: sql`replace(${outreachMessages.body}, ${NAME_PLACEHOLDER}, ${first})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outreachMessages.workspaceId, workspaceId),
          eq(outreachMessages.status, "draft"),
          sql`position(${NAME_PLACEHOLDER} in ${outreachMessages.body}) > 0`,
        ),
      );
}

export async function blockedList(db: AnyDb, workspaceId: string) {
  return db
    .select()
    .from(doNotContact)
    .where(eq(doNotContact.workspaceId, workspaceId))
    .orderBy(asc(doNotContact.value));
}

/** Add an address or a domain; pasted URLs and "mailto:" are reduced to what matters. */
export async function block(db: AnyDb, workspaceId: string, raw: string, reason: string) {
  let value = raw
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "");
  if (!value.includes("@"))
    value = value
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0];
  if (!value || !/[.@]/.test(value))
    return { ok: false as const, message: "Enter an email address or a domain." };
  await db.insert(doNotContact).values({ workspaceId, value, reason }).onConflictDoNothing();
  // anything waiting for that address won't go out
  const blockedNow = [value];
  const waiting = await db
    .select({ id: outreachMessages.id, to: outreachMessages.to })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        inArray(outreachMessages.status, ["draft", "approved"]),
      ),
    );
  const stop = waiting.filter((w) => isBlocked(w.to, blockedNow)).map((w) => w.id);
  if (stop.length)
    await db
      .update(outreachMessages)
      .set({ status: "cancelled", error: "On the do-not-contact list", updatedAt: new Date() })
      .where(inArray(outreachMessages.id, stop));
  return { ok: true as const, value };
}

export async function unblock(db: AnyDb, workspaceId: string, id: string) {
  await db
    .delete(doNotContact)
    .where(and(eq(doNotContact.workspaceId, workspaceId), eq(doNotContact.id, id)));
}

/**
 * The worker step: draft a pitch and a follow-up for targets that are
 * ready (researched, with a contact) and have none yet. Returns how many.
 */
export async function draftPending(db: AnyDb, model: AnalysisModel | null, { limit = 2 } = {}) {
  const ready = await db
    .select({ t: outreachTargets })
    .from(outreachTargets)
    .leftJoin(
      outreachMessages,
      and(eq(outreachMessages.targetId, outreachTargets.id), eq(outreachMessages.kind, "pitch")),
    )
    .where(and(eq(outreachTargets.status, "ready"), isNull(outreachMessages.id)))
    .orderBy(asc(outreachTargets.createdAt))
    .limit(limit);
  let done = 0;
  for (const { t } of ready) {
    const [brand, sender, blocked] = await Promise.all([
      brandOf(db, t.workspaceId),
      getSender(db, t.workspaceId),
      blockedList(db, t.workspaceId),
    ]);
    const contact = t.contact as Contact | null;
    const research = t.research as Research | null;
    if (!brand || !contact || !research) continue;
    if (
      isBlocked(
        contact.email,
        blocked.map((b) => b.value),
      )
    ) {
      await db
        .update(outreachTargets)
        .set({
          status: "skipped",
          note: "The contact is on your do-not-contact list.",
          updatedAt: new Date(),
        })
        .where(eq(outreachTargets.id, t.id));
      continue;
    }
    const facts: TargetFacts = {
      url: t.url,
      domain: t.domain,
      title: t.title,
      research,
      contact,
      evidence: t.evidence as Evidence,
    };
    const s: Sender = sender ?? {
      senderName: null,
      senderEmail: null,
      company: null,
      address: null,
      website: null,
      dailyCap: 10,
    };
    const p =
      (model && (await draftByModel(model, facts, brand.brand, s))) ||
      draftByTemplate(facts, brand.brand, s);
    await db.insert(outreachMessages).values([
      {
        workspaceId: t.workspaceId,
        targetId: t.id,
        kind: "pitch" as const,
        to: contact.email,
        toName: contact.name,
        subject: p.pitch.subject,
        body: p.pitch.body,
        source: p.source,
        costUsd: String(p.costUsd),
      },
      {
        workspaceId: t.workspaceId,
        targetId: t.id,
        kind: "follow_up" as const,
        to: contact.email,
        toName: contact.name,
        subject: p.followUp.subject,
        body: p.followUp.body,
        source: p.source,
      },
    ]);
    await db
      .update(outreachTargets)
      .set({ status: "drafted", updatedAt: new Date() })
      .where(eq(outreachTargets.id, t.id));
    done++;
  }
  return done;
}

/** A target's two messages, for the review page. */
export async function messagesOf(db: AnyDb, workspaceId: string, targetId: string) {
  const rows = await db
    .select()
    .from(outreachMessages)
    .where(
      and(eq(outreachMessages.workspaceId, workspaceId), eq(outreachMessages.targetId, targetId)),
    );
  return {
    pitch: rows.find((r) => r.kind === "pitch") ?? null,
    followUp: rows.find((r) => r.kind === "follow_up") ?? null,
  };
}

/** Save edits to a draft. Approved messages go back to draft when edited: a person approves the final words. */
export async function saveMessage(
  db: AnyDb,
  workspaceId: string,
  id: string,
  edit: { to?: string; subject: string; body: string },
) {
  const [m] = await db
    .select()
    .from(outreachMessages)
    .where(and(eq(outreachMessages.workspaceId, workspaceId), eq(outreachMessages.id, id)))
    .limit(1);
  if (!m) return { ok: false as const, message: "Not found." };
  if (!["draft", "approved"].includes(m.status))
    return { ok: false as const, message: "This email has already been sent or stopped." };
  const changed = (edit.to ?? m.to) !== m.to || edit.subject !== m.subject || edit.body !== m.body;
  await db
    .update(outreachMessages)
    .set({
      to: (edit.to ?? m.to).trim().toLowerCase(),
      subject: edit.subject.trim(),
      body: edit.body.replace(/\r\n/g, "\n").trim(),
      ...(changed ? { status: "draft" as const, approvedAt: null, approvedBy: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(outreachMessages.id, id));
  return { ok: true as const, unapproved: changed && m.status === "approved" };
}

/**
 * Approve a target's pitch and follow-up together, after checking them and
 * the sender details. Approval is the only way a message becomes sendable.
 */
export async function approve(db: AnyDb, workspaceId: string, targetId: string, by: string) {
  const [{ pitch, followUp }, sender, blocked] = await Promise.all([
    messagesOf(db, workspaceId, targetId),
    getSender(db, workspaceId),
    blockedList(db, workspaceId),
  ]);
  if (!pitch) return { ok: false as const, problems: ["There's no draft to approve."] };
  if (pitch.status !== "draft")
    return { ok: false as const, problems: ["Only drafts can be approved."] };
  const values = blocked.map((b) => b.value);
  const problems = [
    ...senderProblems(sender),
    ...messageProblems(pitch, values),
    ...(followUp ? messageProblems(followUp, values).map((p) => `Follow-up: ${p}`) : []),
  ];
  if (problems.length) return { ok: false as const, problems };
  const now = new Date();
  await db
    .update(outreachMessages)
    .set({ status: "approved", approvedAt: now, approvedBy: by, updatedAt: now })
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        eq(outreachMessages.targetId, targetId),
        eq(outreachMessages.status, "draft"),
      ),
    );
  await db
    .update(outreachTargets)
    .set({ status: "approved", updatedAt: now })
    .where(and(eq(outreachTargets.workspaceId, workspaceId), eq(outreachTargets.id, targetId)));
  return { ok: true as const };
}

/** Take an approval back before sending. */
export async function unapprove(db: AnyDb, workspaceId: string, targetId: string) {
  await db
    .update(outreachMessages)
    .set({ status: "draft", approvedAt: null, approvedBy: null, updatedAt: new Date() })
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        eq(outreachMessages.targetId, targetId),
        eq(outreachMessages.status, "approved"),
      ),
    );
  await db
    .update(outreachTargets)
    .set({ status: "drafted", updatedAt: new Date() })
    .where(
      and(
        eq(outreachTargets.workspaceId, workspaceId),
        eq(outreachTargets.id, targetId),
        eq(outreachTargets.status, "approved"),
      ),
    );
}

/** Drop a target's unsent emails and set it aside. */
export async function skipPitch(db: AnyDb, workspaceId: string, targetId: string) {
  await db
    .update(outreachMessages)
    .set({ status: "cancelled", error: "Skipped by you", updatedAt: new Date() })
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        eq(outreachMessages.targetId, targetId),
        inArray(outreachMessages.status, ["draft", "approved"]),
      ),
    );
  await db
    .update(outreachTargets)
    .set({ status: "skipped", note: "Skipped by you.", updatedAt: new Date() })
    .where(and(eq(outreachTargets.workspaceId, workspaceId), eq(outreachTargets.id, targetId)));
}

/** Counts for the Outreach page: drafts to review, approved waiting to send, sent. */
export async function queueCounts(db: AnyDb, workspaceId: string) {
  const rows = await db
    .select({ status: outreachMessages.status, n: sql<number>`count(*)::int` })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.workspaceId, workspaceId), eq(outreachMessages.kind, "pitch")))
    .groupBy(outreachMessages.status);
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { drafts: n("draft"), approved: n("approved"), sent: n("sent") };
}

/**
 * The only way into sending: messages a person approved, and for
 * follow-ups, only once their wait is over (sendAfter is set when the pitch
 * goes out). Drafts, cancelled and sent messages never come back from here.
 */
export async function dueMessages(db: AnyDb, now = new Date(), limit = 50) {
  return db
    .select()
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.status, "approved"),
        isNotNull(outreachMessages.approvedAt),
        or(
          eq(outreachMessages.kind, "pitch"),
          and(eq(outreachMessages.kind, "follow_up"), lte(outreachMessages.sendAfter, now)),
        ),
      ),
    )
    .orderBy(asc(outreachMessages.approvedAt))
    .limit(limit);
}
