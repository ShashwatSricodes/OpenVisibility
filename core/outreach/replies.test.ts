import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  checkReplies,
  checkWins,
  handle,
  imapHostFor,
  kindOf,
  matchTarget,
  openReplies,
  ownWords,
  parseMessage,
  pipeline,
  type Inbox,
  type Incoming,
} from "./replies";

const raw = (headers: Record<string, string>, body: string) =>
  Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n") +
  "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" +
  body.replace(/\n/g, "\r\n");

const reply = raw(
  {
    From: "Priya Nair <Priya@BestApps.blog>",
    To: "asha@ledgerly.app",
    Subject: "Re: Ledgerly for your list",
    "Message-ID": "<r1@bestapps.blog>",
    "In-Reply-To": "<pitch-1@ledgerly.app>",
    References: "<pitch-1@ledgerly.app>",
    Date: "Wed, 29 Oct 2026 10:00:00 +0000",
  },
  "Hi Asha,\n\nThanks, send me a trial account and I'll take a look.\n\nPriya\n\nOn Tue, 28 Oct 2026 at 09:00, Asha Rao <asha@ledgerly.app> wrote:\n> Hi Priya,\n> I read your list…",
);
const outOfOffice = raw(
  {
    From: "Priya Nair <priya@bestapps.blog>",
    Subject: "Automatic reply: Ledgerly for your list",
    "Message-ID": "<ooo@bestapps.blog>",
    "In-Reply-To": "<pitch-1@ledgerly.app>",
    "Auto-Submitted": "auto-replied",
    Date: "Tue, 28 Oct 2026 09:01:00 +0000",
  },
  "I'm away until 3 November.",
);
const bounce = raw(
  {
    From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    To: "asha@ledgerly.app",
    Subject: "Delivery Status Notification (Failure)",
    "Message-ID": "<b1@mx.google.com>",
    Date: "Tue, 28 Oct 2026 09:02:00 +0000",
  },
  "Address not found\n\nYour message wasn't delivered to editor@bestapps.blog because the address couldn't be found.\n\nMessage-ID: <pitch-1@ledgerly.app>",
);

describe("reading replies", () => {
  it("parses a reply, keeps only what they wrote, and knows its thread", async () => {
    const m = (await parseMessage(reply))!;
    expect(m).toMatchObject({
      messageId: "<r1@bestapps.blog>",
      fromAddress: "priya@bestapps.blog",
      fromName: "Priya Nair",
      thread: ["<pitch-1@ledgerly.app>", "<pitch-1@ledgerly.app>"],
      automatic: false,
    });
    expect(ownWords(m.text)).toBe(
      "Hi Asha,\n\nThanks, send me a trial account and I'll take a look.\n\nPriya",
    );
    expect(kindOf(m)).toBe("reply");
  });

  it("ignores out-of-office, spots bounces and opt-outs", async () => {
    expect(kindOf((await parseMessage(outOfOffice))!)).toBeNull();
    expect(kindOf((await parseMessage(bounce))!)).toBe("bounce");
    const base: Incoming = {
      messageId: "<x@a.b>",
      fromAddress: "ed@bestapps.blog",
      fromName: null,
      subject: "Re: Ledgerly",
      date: new Date(),
      thread: [],
      text: "",
      automatic: false,
    };
    for (const t of [
      "Please remove me from your list.",
      "unsubscribe",
      "Don't email me again",
      "Stop emailing us",
    ])
      expect(kindOf({ ...base, text: t })).toBe("opt_out");
    // the opt-out line quoted from our own footer doesn't count
    expect(kindOf({ ...base, text: `Sounds good!\n\n> Not interested? Reply "unsubscribe"` })).toBe(
      "reply",
    );
    expect(kindOf({ ...base, subject: "Out of office" })).toBe("reply"); // no Auto-Submitted, but…
    expect(kindOf({ ...base, subject: "Out of office", automatic: true })).toBeNull();
  });

  it("matches a message to its target: thread, quoted ID, address, then domain", async () => {
    const sent = [
      {
        targetId: "t1",
        messageId: "<pitch-1@ledgerly.app>",
        to: "editor@bestapps.blog",
        domain: "bestapps.blog",
      },
      {
        targetId: "t2",
        messageId: "<pitch-2@ledgerly.app>",
        to: "hi@other.blog",
        domain: "other.blog",
      },
    ];
    const at = (p: Partial<Incoming>): Incoming => ({
      messageId: "<m@x>",
      fromAddress: "someone@nowhere.com",
      fromName: null,
      subject: "",
      date: new Date(),
      thread: [],
      text: "",
      automatic: false,
      ...p,
    });
    expect(matchTarget(at({ thread: ["<pitch-2@ledgerly.app>"] }), sent)).toBe("t2");
    expect(matchTarget((await parseMessage(bounce))!, sent)).toBe("t1");
    expect(matchTarget(at({ fromAddress: "hi@other.blog" }), sent)).toBe("t2");
    expect(matchTarget(at({ fromAddress: "priya@bestapps.blog" }), sent)).toBe("t1");
    expect(matchTarget(at({ fromAddress: "boss@news.other.blog" }), sent)).toBe("t2");
    // a gmail address says nothing about which site it's from
    expect(matchTarget(at({ fromAddress: "priya.nair@gmail.com" }), sent)).toBeNull();
    expect(imapHostFor("smtp.gmail.com")).toBe("imap.gmail.com");
    expect(imapHostFor("smtp.mailbox.example")).toBe("imap.mailbox.example");
  });
});

describe("acting on replies, and results", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  let brandId: string;
  let targetId: string;
  const sentAt = new Date("2026-10-28T09:00:00Z");

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Replies" })
      .returning();
    [{ id: brandId }] = await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] })
      .returning();
    [{ id: targetId }] = await db
      .insert(schema.outreachTargets)
      .values({
        workspaceId,
        url: "https://bestapps.blog/invoicing",
        domain: "bestapps.blog",
        status: "sent",
        evidence: { answers: 1, prompts: [], engines: [], rivals: [], withYou: 0 },
      })
      .returning();
    await db.insert(schema.outreachMessages).values([
      {
        workspaceId,
        targetId,
        kind: "pitch",
        status: "sent",
        to: "editor@bestapps.blog",
        subject: "Ledgerly for your list",
        body: "Hi",
        source: "template",
        approvedAt: sentAt,
        sentAt,
        messageId: "<pitch-1@ledgerly.app>",
      },
      {
        workspaceId,
        targetId,
        kind: "follow_up",
        status: "approved",
        to: "editor@bestapps.blog",
        subject: "Re: Ledgerly for your list",
        body: "Hi again",
        source: "template",
        approvedAt: sentAt,
        sendAfter: new Date(sentAt.getTime() + 7 * 86_400_000),
      },
    ]);
  }, 60_000);

  const target = async () =>
    (
      await db.select().from(schema.outreachTargets).where(eq(schema.outreachTargets.id, targetId))
    )[0];
  const followUp = async () =>
    (
      await db
        .select()
        .from(schema.outreachMessages)
        .where(eq(schema.outreachMessages.kind, "follow_up"))
    )[0];

  it("a reply stops the follow-up and waits for you, once", async () => {
    const m = (await parseMessage(reply))!;
    expect(await handle(db, workspaceId, [m, (await parseMessage(outOfOffice))!])).toBe(1);
    expect(await handle(db, workspaceId, [m])).toBe(0);
    expect((await target()).status).toBe("replied");
    expect(await followUp()).toMatchObject({ status: "cancelled", error: "They replied" });
    expect(await openReplies(db, workspaceId)).toEqual([
      expect.objectContaining({
        kind: "reply",
        fromAddress: "priya@bestapps.blog",
        snippet: "Hi Asha,\n\nThanks, send me a trial account and I'll take a look.\n\nPriya",
      }),
    ]);
    expect(await pipeline(db, workspaceId)).toMatchObject({ sent: 1, replied: 1, won: 0 });
  });

  it("an opt-out goes on the do-not-contact list; a bounce marks the address bad", async () => {
    const optOut: Incoming = {
      ...(await parseMessage(reply))!,
      messageId: "<r2@bestapps.blog>",
      text: "Please remove me from your list.",
    };
    await handle(db, workspaceId, [optOut]);
    const blocked = await db.select().from(schema.doNotContact);
    expect(blocked.map((b) => [b.value, b.reason])).toEqual([
      ["priya@bestapps.blog", "Asked not to be emailed"],
    ]);
    expect((await target()).note).toMatch(/do-not-contact list/);

    await db.update(schema.outreachTargets).set({ status: "sent", note: null });
    await handle(db, workspaceId, [(await parseMessage(bounce))!]);
    expect(await target()).toMatchObject({
      status: "no_contact",
      note: "editor@bestapps.blog bounced; look for another way to reach them.",
    });
  });

  it("reads each mailbox at most every ten minutes, and records errors", async () => {
    let reads = 0;
    const inbox: Inbox = {
      since: async () => {
        reads++;
        return [(await parseMessage(reply))!];
      },
    };
    await db.insert(schema.outreachSettings).values({ workspaceId });
    const now = new Date("2026-10-29T12:00:00Z");
    expect(await checkReplies(db, async () => inbox, now)).toBe(1);
    expect(await checkReplies(db, async () => inbox, new Date(now.getTime() + 60_000))).toBe(0);
    expect(reads).toBe(1);
    const broken: Inbox = {
      since: async () => {
        throw new Error("Invalid credentials (Failure)");
      },
    };
    await checkReplies(db, async () => broken, new Date(now.getTime() + 11 * 60_000));
    const [s] = await db.select().from(schema.outreachSettings);
    expect(s.imapError).toBe("Invalid credentials (Failure)");
  });

  it("is won when a later run cites the page in an answer that names you", async () => {
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId, trigger: "manual" })
      .returning();
    const answer = async (at: Date, namesYou: boolean, url = "https://bestapps.blog/invoicing") => {
      const [item] = await db
        .insert(schema.runItems)
        .values({ runId: run.id, promptText: "p", engine: "chatgpt", source: "consumer_app" })
        .returning();
      const [a] = await db
        .insert(schema.answers)
        .values({ runItemId: item.id, text: "…", createdAt: at })
        .returning();
      await db
        .insert(schema.citations)
        .values({ answerId: a.id, url, domain: "bestapps.blog", kind: "third_party" });
      if (namesYou)
        await db
          .insert(schema.mentions)
          .values({ answerId: a.id, competitorId: null, position: 1 });
    };
    // before the pitch, or without naming you, or another page: not a win
    await answer(new Date(sentAt.getTime() - 86_400_000), true);
    await answer(new Date(sentAt.getTime() + 86_400_000), false);
    await answer(new Date(sentAt.getTime() + 86_400_000), true, "https://bestapps.blog/other");
    expect(await checkWins(db)).toBe(0);
    const won = new Date(sentAt.getTime() + 3 * 86_400_000);
    await answer(won, true);
    expect(await checkWins(db)).toBe(1);
    expect(await target()).toMatchObject({ status: "won", wonAt: won });
    expect(await checkWins(db)).toBe(0);
    expect(await pipeline(db, workspaceId)).toMatchObject({ sent: 1, won: 1 });
  });
});
