/**
 * Sending approved outreach from the user's own mailbox, over SMTP.
 *
 * Every send goes through the same checks, at the moment of sending:
 * - only messages a person approved (dueMessages), never drafts;
 * - not to anyone on the do-not-contact list (checked again here);
 * - one pitch per site per quarter, whatever page it was about;
 * - no more than the daily cap a day; the rest wait for tomorrow;
 * - a follow-up only if the site hasn't replied, a week after the pitch.
 *
 * Each email carries the sender block, postal address and opt-out line
 * (footerOf) and a List-Unsubscribe header. Temporary SMTP errors leave the
 * message approved to try again later; permanent ones mark it failed, with
 * the server's reason, for the user to look at.
 */

import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { outreachMessages, outreachSettings, outreachTargets } from "@/db/schema";
import { decrypt, encrypt } from "../crypto";
import {
  FOLLOW_UP_DAYS,
  blockedList,
  dueMessages,
  footerOf,
  getSender,
  isBlocked,
  type Sender,
} from "./pitch";

export const QUARTER_DAYS = 90;
/** a temporary failure waits this long before the next try */
const RETRY_MS = 15 * 60_000;
/** at most this many sends per worker tick, across workspaces */
const PER_TICK = 5;

export type Outgoing = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  listUnsubscribe: string;
};

export type Mailer = { send: (m: Outgoing) => Promise<void>; verify: () => Promise<void> };

export type Smtp = { host: string; port: number; secure: boolean; user: string; password: string };

/** A Mailer that sends through an SMTP server with nodemailer. */
export function smtpMailer(
  c: Smtp,
  /** tests only: a local SMTP server without TLS */
  { plaintextForTests = false } = {},
): Mailer {
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    // with STARTTLS, refuse to send in the clear
    requireTLS: !c.secure && !plaintextForTests,
    ignoreTLS: plaintextForTests,
    auth: { user: c.user, pass: c.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return {
    verify: async () => {
      await transport.verify();
    },
    send: async (m) => {
      await transport.sendMail({
        from: m.from,
        to: m.to,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo,
        references: m.references,
        headers: { "List-Unsubscribe": m.listUnsubscribe },
      });
    },
  };
}

/* ── settings ─────────────────────────────────────────────── */

export async function smtpOf(db: AnyDb, workspaceId: string): Promise<Smtp | null> {
  const [s] = await db
    .select()
    .from(outreachSettings)
    .where(eq(outreachSettings.workspaceId, workspaceId))
    .limit(1);
  if (!s?.smtpHost || !s.smtpPort || !s.smtpUser || !s.smtpPassword) return null;
  return {
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    user: s.smtpUser,
    password: decrypt(s.smtpPassword, `smtp:${workspaceId}`),
  };
}

/** Save the SMTP login; an empty password keeps the saved one. */
export async function saveSmtp(
  db: AnyDb,
  workspaceId: string,
  c: { host: string; port: number; secure: boolean; user: string; password?: string },
) {
  const host = c.host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))
    return { ok: false as const, message: "Enter the server's host name, like smtp.gmail.com." };
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
    return { ok: false as const, message: "Enter the port, usually 465 or 587." };
  if (!c.user.trim())
    return { ok: false as const, message: "Enter the username, usually your email address." };
  const values = {
    smtpHost: host,
    smtpPort: c.port,
    smtpSecure: c.secure,
    smtpUser: c.user.trim(),
    ...(c.password ? { smtpPassword: encrypt(c.password, `smtp:${workspaceId}`) } : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(outreachSettings)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: outreachSettings.workspaceId, set: values });
  await clearSendErrors(db, workspaceId);
  return { ok: true as const };
}

/** A new or removed mailbox makes old "last try failed" errors meaningless; try afresh. */
async function clearSendErrors(db: AnyDb, workspaceId: string) {
  await db
    .update(outreachMessages)
    .set({ error: null, updatedAt: new Date(0) })
    .where(
      and(eq(outreachMessages.workspaceId, workspaceId), eq(outreachMessages.status, "approved")),
    );
}

/* ── composing ────────────────────────────────────────────── */

const domainOf = (email: string) => email.split("@")[1] ?? "localhost";

/** The email as it goes out: the approved text, then the fixed footer. */
export function compose(
  m: { to: string; toName: string | null; subject: string; body: string },
  sender: Sender,
  thread?: { messageId: string },
): Outgoing {
  const from = sender.senderName
    ? `"${sender.senderName.replace(/"/g, "")}" <${sender.senderEmail}>`
    : sender.senderEmail!;
  return {
    from,
    to: m.toName ? `"${m.toName.replace(/"/g, "")}" <${m.to}>` : m.to,
    replyTo: sender.senderEmail!,
    subject: m.subject,
    text: `${m.body}\n\n${footerOf(sender)}\n`,
    messageId: `<${randomUUID()}@${domainOf(sender.senderEmail!)}>`,
    ...(thread ? { inReplyTo: thread.messageId, references: thread.messageId } : {}),
    listUnsubscribe: `<mailto:${sender.senderEmail}?subject=unsubscribe>`,
  };
}

/** SMTP replies in the 5xx range, and refused logins, won't work on a second try. */
export function isPermanent(err: unknown) {
  const e = err as { responseCode?: number; code?: string };
  return (
    (e.responseCode !== undefined && e.responseCode >= 500) ||
    e.code === "EAUTH" ||
    e.code === "EENVELOPE"
  );
}

const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/* ── the worker step ──────────────────────────────────────── */

export async function sendDue(
  db: AnyDb,
  mailerFor: (workspaceId: string) => Promise<Mailer | null>,
  now = new Date(),
) {
  const report = { sent: 0, waiting: 0, stopped: 0, failed: 0 };
  const due = await dueMessages(db, now, 50);
  const full = new Set<string>();
  const mailers = new Map<string, Mailer | null>();
  for (const m of due) {
    if (report.sent >= PER_TICK) break;
    if (full.has(m.workspaceId)) continue;
    // a temporary failure waits before the next try
    if (m.error && now.getTime() - m.updatedAt.getTime() < RETRY_MS) continue;

    const stop = async (reason: string) => {
      // a stopped pitch takes its follow-up with it, and the target says why
      await db
        .update(outreachMessages)
        .set({ status: "cancelled", error: reason, updatedAt: now })
        .where(
          m.kind === "pitch"
            ? and(
                eq(outreachMessages.targetId, m.targetId),
                inArray(outreachMessages.status, ["draft", "approved"]),
              )
            : eq(outreachMessages.id, m.id),
        );
      if (m.kind === "pitch")
        await db
          .update(outreachTargets)
          .set({ status: "skipped", note: `Not sent: ${reason}.`, updatedAt: now })
          .where(
            and(
              eq(outreachTargets.id, m.targetId),
              inArray(outreachTargets.status, ["approved", "drafted"]),
            ),
          );
      report.stopped++;
    };
    const [target] = await db
      .select()
      .from(outreachTargets)
      .where(eq(outreachTargets.id, m.targetId))
      .limit(1);
    if (!target) continue;
    if (["replied", "won", "skipped"].includes(target.status)) {
      await stop(target.status === "skipped" ? "Skipped" : "They replied; no follow-up needed");
      continue;
    }
    const blocked = (await blockedList(db, m.workspaceId)).map((b) => b.value);
    if (isBlocked(m.to, blocked)) {
      await stop("On the do-not-contact list");
      continue;
    }
    if (m.kind === "pitch") {
      // one pitch per site per quarter, whichever page it was about
      const [recent] = await db
        .select({ sentAt: outreachMessages.sentAt })
        .from(outreachMessages)
        .innerJoin(outreachTargets, eq(outreachMessages.targetId, outreachTargets.id))
        .where(
          and(
            eq(outreachMessages.workspaceId, m.workspaceId),
            eq(outreachMessages.kind, "pitch"),
            eq(outreachMessages.status, "sent"),
            eq(outreachTargets.domain, target.domain),
            ne(outreachMessages.id, m.id),
            gte(outreachMessages.sentAt, new Date(now.getTime() - QUARTER_DAYS * 86_400_000)),
          ),
        )
        .limit(1);
      if (recent) {
        await stop(
          `${target.domain} was emailed on ${recent.sentAt!.toISOString().slice(0, 10)}; one email per site per quarter`,
        );
        continue;
      }
    }
    const sender = await getSender(db, m.workspaceId);
    if (!sender?.senderEmail) continue;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.workspaceId, m.workspaceId),
          eq(outreachMessages.status, "sent"),
          gte(outreachMessages.sentAt, startOfDay(now)),
        ),
      );
    if (n >= sender.dailyCap) {
      full.add(m.workspaceId);
      report.waiting++;
      continue;
    }
    if (!mailers.has(m.workspaceId)) mailers.set(m.workspaceId, await mailerFor(m.workspaceId));
    const mailer = mailers.get(m.workspaceId);
    if (!mailer) {
      report.waiting++;
      continue;
    }

    const thread =
      m.kind === "follow_up"
        ? (
            await db
              .select({ messageId: outreachMessages.messageId })
              .from(outreachMessages)
              .where(
                and(eq(outreachMessages.targetId, m.targetId), eq(outreachMessages.kind, "pitch")),
              )
              .limit(1)
          )[0]
        : undefined;
    const out = compose(m, sender, thread?.messageId ? { messageId: thread.messageId } : undefined);
    // claim it, so two workers can't both send it
    const claimed = await db
      .update(outreachMessages)
      .set({ updatedAt: now })
      .where(and(eq(outreachMessages.id, m.id), eq(outreachMessages.status, "approved")))
      .returning({ id: outreachMessages.id });
    if (!claimed.length) continue;
    try {
      await mailer.send(out);
    } catch (err) {
      const permanent = isPermanent(err);
      await db
        .update(outreachMessages)
        .set({
          ...(permanent ? { status: "failed" as const } : {}),
          error: String((err as Error).message ?? err).slice(0, 300),
          updatedAt: now,
        })
        .where(eq(outreachMessages.id, m.id));
      report.failed++;
      continue;
    }
    await db
      .update(outreachMessages)
      .set({ status: "sent", sentAt: now, messageId: out.messageId, error: null, updatedAt: now })
      .where(eq(outreachMessages.id, m.id));
    if (m.kind === "pitch") {
      // the follow-up waits a week, and only goes if it was approved with the pitch
      await db
        .update(outreachMessages)
        .set({ sendAfter: new Date(now.getTime() + FOLLOW_UP_DAYS * 86_400_000), updatedAt: now })
        .where(
          and(eq(outreachMessages.targetId, m.targetId), eq(outreachMessages.kind, "follow_up")),
        );
      await db
        .update(outreachTargets)
        .set({ status: "sent", updatedAt: now })
        .where(eq(outreachTargets.id, m.targetId));
    }
    report.sent++;
  }
  return report;
}

/** Send a failed email again: it was approved, and its words haven't changed. */
export async function retry(db: AnyDb, workspaceId: string, targetId: string) {
  await db
    .update(outreachMessages)
    .set({ status: "approved", error: null, updatedAt: new Date(0) })
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        eq(outreachMessages.targetId, targetId),
        eq(outreachMessages.status, "failed"),
        sql`${outreachMessages.approvedAt} is not null`,
      ),
    );
}

/** Check the SMTP login, and send a test email to the sender's own address. */
export async function testMailbox(mailer: Mailer, sender: Sender) {
  try {
    await mailer.verify();
    await mailer.send(
      compose(
        {
          to: sender.senderEmail!,
          toName: null,
          subject: "OpenVisibility: test email",
          body: "This is a test from OpenVisibility's outreach settings. If it reached you, sending works.",
        },
        sender,
      ),
    );
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, message: String((err as Error).message ?? err).slice(0, 300) };
  }
}

/** What's been sent, newest first, with the follow-up's state. */
export async function sentLog(db: AnyDb, workspaceId: string) {
  return db
    .select({
      id: outreachMessages.id,
      targetId: outreachMessages.targetId,
      kind: outreachMessages.kind,
      to: outreachMessages.to,
      subject: outreachMessages.subject,
      status: outreachMessages.status,
      sentAt: outreachMessages.sentAt,
      sendAfter: outreachMessages.sendAfter,
      error: outreachMessages.error,
      domain: outreachTargets.domain,
    })
    .from(outreachMessages)
    .innerJoin(outreachTargets, eq(outreachMessages.targetId, outreachTargets.id))
    .where(
      and(
        eq(outreachMessages.workspaceId, workspaceId),
        inArray(outreachMessages.status, ["sent", "failed", "approved", "cancelled"]),
      ),
    )
    .orderBy(sql`${outreachMessages.sentAt} desc nulls first`);
}

/** The mailbox settings for the settings page: everything but the password itself. */
export async function mailboxInfo(db: AnyDb, workspaceId: string) {
  const [s] = await db
    .select({
      host: outreachSettings.smtpHost,
      port: outreachSettings.smtpPort,
      secure: outreachSettings.smtpSecure,
      user: outreachSettings.smtpUser,
      hasPassword: sql<boolean>`${outreachSettings.smtpPassword} is not null`,
    })
    .from(outreachSettings)
    .where(eq(outreachSettings.workspaceId, workspaceId))
    .limit(1);
  return {
    host: s?.host ?? "",
    port: s?.port ?? 465,
    secure: s?.secure ?? true,
    user: s?.user ?? "",
    hasPassword: !!s?.hasPassword,
    ready: !!(s?.host && s.port && s.user && s.hasPassword),
  };
}

/** Forget the mailbox: approved emails wait until one is set up again. */
export async function removeSmtp(db: AnyDb, workspaceId: string) {
  await db
    .update(outreachSettings)
    .set({
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      updatedAt: new Date(),
    })
    .where(eq(outreachSettings.workspaceId, workspaceId));
  await clearSendErrors(db, workspaceId);
}
