/**
 * Replies and results: reading the user's mailbox over IMAP for answers to
 * outreach, and watching later runs for the pages that start citing the
 * brand.
 *
 * - A reply stops the follow-up and is shown to the user to answer
 *   themselves; the agent never replies on its own.
 * - "Unsubscribe", "remove me" and the like add the address to the
 *   do-not-contact list, which also cancels anything waiting for it.
 * - Bounces mark the address as bad; out-of-office replies are ignored, so
 *   the follow-up still goes.
 * - A target is won when a run after the pitch shows its page cited in an
 *   answer that names the brand.
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { and, eq, gt, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import {
  answers,
  citations,
  mentions,
  outreachMessages,
  outreachReplies,
  outreachSettings,
  outreachTargets,
  runItems,
  runs,
} from "@/db/schema";
import { decrypt } from "../crypto";
import { block } from "./pitch";

export type Incoming = {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  date: Date;
  /** In-Reply-To and References, as Message-IDs */
  thread: string[];
  text: string;
  /** the Auto-Submitted header, or a guess from the subject: out of office and the like */
  automatic: boolean;
};

export type Inbox = { since: (date: Date) => Promise<Incoming[]> };

/* ── reading a message ────────────────────────────────────── */

const ids = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s+/) : [])
    .map((x) => String(x).trim())
    .filter((x) => /^<.+>$/.test(x));

const AUTO_SUBJECT =
  /^(auto(matic)?[ -]?(reply|response)|out of (the )?office|away from|on (leave|vacation|holiday))/i;

/** A raw RFC 822 message as the agent needs it. */
export async function parseMessage(raw: string | Buffer): Promise<Incoming | null> {
  const m = await simpleParser(raw);
  const from = (m.from as AddressObject | undefined)?.value?.[0];
  if (!from?.address || !m.messageId) return null;
  const auto = String(m.headers.get("auto-submitted") ?? "no").toLowerCase();
  return {
    messageId: m.messageId,
    fromAddress: from.address.toLowerCase(),
    fromName: from.name || null,
    subject: m.subject ?? "",
    date: m.date ?? new Date(),
    thread: [...ids(m.inReplyTo), ...ids(m.references)],
    text: m.text ?? "",
    automatic: (auto !== "no" && auto !== "") || AUTO_SUBJECT.test(m.subject ?? ""),
  };
}

/** What they wrote, without the email they're replying to. */
export function ownWords(text: string, max = 500) {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) break;
    if (
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())
    )
      break;
    if (/^(From|Sent|To|Subject):\s/.test(line) && lines.length) break;
    lines.push(line);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const BOUNCE_FROM = /^(mailer-daemon|postmaster|mail-daemon|bounce)/i;
const BOUNCE_SUBJECT =
  /undeliver|delivery status notification|failure notice|returned mail|delivery (has )?failed|mail delivery (failed|subsystem)|could not be delivered/i;
const OPT_OUT =
  /\b(unsubscribe|opt[ -]?out|remove (me|us|my (email|address))|take (me|us) off|stop (emailing|contacting|sending)|(do not|don't|dont) (email|contact|write)|no (more|further) emails?)\b/i;

export function kindOf(m: Incoming): "reply" | "opt_out" | "bounce" | null {
  if (BOUNCE_FROM.test(m.fromAddress) || BOUNCE_SUBJECT.test(m.subject)) return "bounce";
  if (m.automatic) return null;
  if (OPT_OUT.test(m.subject) || OPT_OUT.test(ownWords(m.text, 2_000))) return "opt_out";
  return "reply";
}

const FREEMAIL = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "live.com",
];

/**
 * Which target a message is about: by the thread headers first, then by the
 * original Message-ID quoted in a bounce, then by who sent it.
 */
export function matchTarget(
  m: Incoming,
  sent: { targetId: string; messageId: string | null; to: string; domain: string }[],
): string | null {
  const byThread = sent.find((s) => s.messageId && m.thread.includes(s.messageId));
  if (byThread) return byThread.targetId;
  const quoted = sent.find((s) => s.messageId && m.text.includes(s.messageId));
  if (quoted) return quoted.targetId;
  const byAddress = sent.find((s) => s.to === m.fromAddress);
  if (byAddress) return byAddress.targetId;
  const domain = m.fromAddress.split("@")[1] ?? "";
  if (FREEMAIL.includes(domain)) return null;
  return (
    sent.find(
      (s) => domain === s.domain || domain.endsWith(`.${s.domain}`) || s.to.endsWith(`@${domain}`),
    )?.targetId ?? null
  );
}

/* ── the mailbox ──────────────────────────────────────────── */

/** IMAP host for a known SMTP host: smtp.gmail.com → imap.gmail.com. */
export function imapHostFor(smtpHost: string) {
  const known: Record<string, string> = {
    "smtp.gmail.com": "imap.gmail.com",
    "smtp.office365.com": "outlook.office365.com",
    "smtp-mail.outlook.com": "outlook.office365.com",
    "smtp.zoho.com": "imap.zoho.com",
    "smtp.zoho.in": "imap.zoho.in",
    "smtp.fastmail.com": "imap.fastmail.com",
    "smtp.mail.yahoo.com": "imap.mail.yahoo.com",
  };
  return known[smtpHost] ?? smtpHost.replace(/^smtp\./, "imap.");
}

/** An Inbox over IMAP (TLS), reading INBOX without marking anything as read. */
export function imapInbox(c: {
  host: string;
  port: number;
  user: string;
  password: string;
}): Inbox {
  return {
    since: async (date) => {
      const client = new ImapFlow({
        host: c.host,
        port: c.port,
        secure: true,
        auth: { user: c.user, pass: c.password },
        logger: false,
      });
      await client.connect();
      const out: Incoming[] = [];
      try {
        const lock = await client.getMailboxLock("INBOX", { readOnly: true });
        try {
          const uids = (await client.search({ since: date }, { uid: true })) || [];
          for await (const msg of client.fetch(uids.slice(-300), { source: true }, { uid: true })) {
            if (!msg.source) continue;
            const parsed = await parseMessage(msg.source);
            if (parsed) out.push(parsed);
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => {});
      }
      return out;
    },
  };
}

export async function imapOf(db: AnyDb, workspaceId: string) {
  const [s] = await db
    .select()
    .from(outreachSettings)
    .where(eq(outreachSettings.workspaceId, workspaceId))
    .limit(1);
  if (!s?.smtpHost || !s.smtpUser || !s.smtpPassword) return null;
  return {
    host: s.imapHost ?? imapHostFor(s.smtpHost),
    port: s.imapPort ?? 993,
    user: s.smtpUser,
    password: decrypt(s.smtpPassword, `smtp:${workspaceId}`),
  };
}

/* ── the worker steps ─────────────────────────────────────── */

/** How often a mailbox is read. */
const EVERY_MS = 10 * 60_000;

/** Read each mailbox with outreach in flight, and act on what came back. Returns replies found. */
export async function checkReplies(
  db: AnyDb,
  inboxFor: (workspaceId: string) => Promise<Inbox | null>,
  now = new Date(),
) {
  // workspaces with emails sent in the last 60 days
  const active = await db
    .select({
      workspaceId: outreachMessages.workspaceId,
      first: sql<string>`min(${outreachMessages.sentAt})::text`,
    })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.status, "sent"),
        gt(outreachMessages.sentAt, new Date(now.getTime() - 60 * 86_400_000)),
      ),
    )
    .groupBy(outreachMessages.workspaceId);
  let found = 0;
  for (const a of active) {
    const [settings] = await db
      .select({ checked: outreachSettings.imapCheckedAt })
      .from(outreachSettings)
      .where(eq(outreachSettings.workspaceId, a.workspaceId))
      .limit(1);
    if (settings?.checked && now.getTime() - settings.checked.getTime() < EVERY_MS) continue;
    const inbox = await inboxFor(a.workspaceId);
    if (!inbox) continue;
    let messages: Incoming[];
    try {
      // a day's overlap: IMAP's SINCE works in whole days
      const from = new Date(
        Math.max(new Date(a.first).getTime(), settings?.checked?.getTime() ?? 0) - 86_400_000,
      );
      messages = await inbox.since(from);
    } catch (err) {
      await db
        .update(outreachSettings)
        .set({ imapCheckedAt: now, imapError: String((err as Error).message ?? err).slice(0, 300) })
        .where(eq(outreachSettings.workspaceId, a.workspaceId));
      continue;
    }
    found += await handle(db, a.workspaceId, messages);
    await db
      .update(outreachSettings)
      .set({ imapCheckedAt: now, imapError: null })
      .where(eq(outreachSettings.workspaceId, a.workspaceId));
  }
  return found;
}

/** Store and act on the messages that answer this workspace's outreach. */
export async function handle(db: AnyDb, workspaceId: string, messages: Incoming[]) {
  const sent = await db
    .select({
      targetId: outreachMessages.targetId,
      messageId: outreachMessages.messageId,
      to: outreachMessages.to,
      domain: outreachTargets.domain,
    })
    .from(outreachMessages)
    .innerJoin(outreachTargets, eq(outreachMessages.targetId, outreachTargets.id))
    .where(and(eq(outreachMessages.workspaceId, workspaceId), eq(outreachMessages.status, "sent")));
  if (!sent.length) return 0;
  const seen = new Set(
    (
      await db
        .select({ id: outreachReplies.messageId })
        .from(outreachReplies)
        .where(eq(outreachReplies.workspaceId, workspaceId))
    ).map((r) => r.id),
  );
  const ours = new Set(sent.map((s) => s.messageId));
  let n = 0;
  for (const m of messages.sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (seen.has(m.messageId) || ours.has(m.messageId)) continue;
    const kind = kindOf(m);
    if (!kind) continue;
    const targetId = matchTarget(m, sent);
    if (!targetId) continue;
    await db
      .insert(outreachReplies)
      .values({
        workspaceId,
        targetId,
        messageId: m.messageId,
        kind,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        subject: m.subject.slice(0, 300),
        snippet: ownWords(m.text),
        receivedAt: m.date,
      })
      .onConflictDoNothing();
    seen.add(m.messageId);
    n++;

    // nothing else goes to this site for now
    await db
      .update(outreachMessages)
      .set({
        status: "cancelled",
        error: kind === "bounce" ? "The address bounced" : "They replied",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outreachMessages.targetId, targetId),
          inArray(outreachMessages.status, ["draft", "approved"]),
        ),
      );
    if (kind === "opt_out") await block(db, workspaceId, m.fromAddress, "Asked not to be emailed");
    if (kind === "bounce") {
      const to = sent.find((s) => s.targetId === targetId)?.to;
      await db
        .update(outreachTargets)
        .set({
          status: "no_contact",
          note: `${to ?? "The address"} bounced; look for another way to reach them.`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outreachTargets.id, targetId),
            inArray(outreachTargets.status, ["sent", "replied"]),
          ),
        );
    } else {
      await db
        .update(outreachTargets)
        .set({
          status: "replied",
          note:
            kind === "opt_out"
              ? "Asked not to be emailed again; added to your do-not-contact list."
              : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outreachTargets.id, targetId),
            inArray(outreachTargets.status, ["sent", "replied"]),
          ),
        );
    }
  }
  return n;
}

/**
 * Wins: targets pitched before a run whose answers now cite their page and
 * name the brand. Returns how many were marked won.
 */
export async function checkWins(db: AnyDb) {
  const rows = await db
    .select({
      targetId: outreachTargets.id,
      at: sql<string>`min(${answers.createdAt})::text`,
    })
    .from(outreachTargets)
    .innerJoin(
      outreachMessages,
      and(
        eq(outreachMessages.targetId, outreachTargets.id),
        eq(outreachMessages.kind, "pitch"),
        eq(outreachMessages.status, "sent"),
      ),
    )
    .innerJoin(runs, eq(runs.workspaceId, outreachTargets.workspaceId))
    .innerJoin(runItems, eq(runItems.runId, runs.id))
    .innerJoin(
      answers,
      and(eq(answers.runItemId, runItems.id), gt(answers.createdAt, outreachMessages.sentAt)),
    )
    .innerJoin(
      citations,
      and(eq(citations.answerId, answers.id), eq(citations.url, outreachTargets.url)),
    )
    .innerJoin(mentions, and(eq(mentions.answerId, answers.id), isNull(mentions.competitorId)))
    .where(
      and(
        inArray(outreachTargets.status, ["sent", "replied"]),
        isNull(outreachTargets.wonAt),
        isNotNull(outreachMessages.sentAt),
      ),
    )
    .groupBy(outreachTargets.id);
  for (const r of rows)
    await db
      .update(outreachTargets)
      .set({ status: "won", wonAt: new Date(r.at), note: null, updatedAt: new Date() })
      .where(eq(outreachTargets.id, r.targetId));
  return rows.length;
}

/** Replies waiting for the user, newest first. */
export async function openReplies(db: AnyDb, workspaceId: string) {
  return db
    .select({
      id: outreachReplies.id,
      targetId: outreachReplies.targetId,
      kind: outreachReplies.kind,
      fromAddress: outreachReplies.fromAddress,
      fromName: outreachReplies.fromName,
      subject: outreachReplies.subject,
      snippet: outreachReplies.snippet,
      receivedAt: outreachReplies.receivedAt,
      domain: outreachTargets.domain,
    })
    .from(outreachReplies)
    .innerJoin(outreachTargets, eq(outreachReplies.targetId, outreachTargets.id))
    .where(and(eq(outreachReplies.workspaceId, workspaceId), eq(outreachReplies.handled, false)))
    .orderBy(sql`${outreachReplies.receivedAt} desc`);
}

export async function markHandled(db: AnyDb, workspaceId: string, id: string) {
  await db
    .update(outreachReplies)
    .set({ handled: true })
    .where(and(eq(outreachReplies.workspaceId, workspaceId), eq(outreachReplies.id, id)));
}

/** The pipeline, from found to won, for the Outreach page. */
export async function pipeline(db: AnyDb, workspaceId: string) {
  const rows = await db
    .select({ status: outreachTargets.status, n: sql<number>`count(*)::int` })
    .from(outreachTargets)
    .where(eq(outreachTargets.workspaceId, workspaceId))
    .groupBy(outreachTargets.status);
  const n = (...s: string[]) =>
    rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
  return {
    found: n(
      "found",
      "ready",
      "no_contact",
      "task",
      "drafted",
      "approved",
      "sent",
      "replied",
      "won",
    ),
    toReview: n("drafted"),
    approved: n("approved"),
    sent: n("sent", "replied", "won"),
    replied: n("replied", "won"),
    won: n("won"),
  };
}

/** Where replies are read from; an empty host goes back to the one worked out from SMTP. */
export async function saveImap(db: AnyDb, workspaceId: string, f: { host: string; port: number }) {
  const host = f.host.trim().toLowerCase();
  if (host && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))
    return {
      ok: false as const,
      message: "Enter the IMAP server's host name, like imap.gmail.com.",
    };
  if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535)
    return { ok: false as const, message: "Enter the port, usually 993." };
  await db
    .update(outreachSettings)
    .set({ imapHost: host || null, imapPort: f.port, imapError: null, imapCheckedAt: null })
    .where(eq(outreachSettings.workspaceId, workspaceId));
  return { ok: true as const };
}

/** For the settings page: where replies are read from, and how the last read went. */
export async function imapInfo(db: AnyDb, workspaceId: string) {
  const [s] = await db
    .select({
      smtpHost: outreachSettings.smtpHost,
      host: outreachSettings.imapHost,
      port: outreachSettings.imapPort,
      checked: outreachSettings.imapCheckedAt,
      error: outreachSettings.imapError,
    })
    .from(outreachSettings)
    .where(eq(outreachSettings.workspaceId, workspaceId))
    .limit(1);
  return {
    host: s?.host ?? "",
    guessed: s?.smtpHost ? imapHostFor(s.smtpHost) : "",
    port: s?.port ?? 993,
    checked: s?.checked ?? null,
    error: s?.error ?? null,
  };
}
