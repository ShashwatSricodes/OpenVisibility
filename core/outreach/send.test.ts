import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { approve, draftPending, messagesOf, saveSender } from "./pitch";
import {
  compose,
  isPermanent,
  removeSmtp,
  retry,
  saveSmtp,
  sendDue,
  smtpMailer,
  smtpOf,
  type Mailer,
} from "./send";

/* a real SMTP server on a random local port: emails travel over SMTP, and land here */
type Received = { from: string; to: string[]; raw: string };
const inbox: Received[] = [];
let refuse: string | null = null;
const server = new SMTPServer({
  authOptional: false,
  allowInsecureAuth: true,
  disabledCommands: ["STARTTLS"],
  logger: false,
  onAuth: (auth, _s, cb) =>
    auth.username === "asha@ledgerly.app" && auth.password === "app-password"
      ? cb(null, { user: auth.username })
      : cb(new Error("Invalid login")),
  onRcptTo: (address, _s, cb) =>
    refuse && address.address === refuse
      ? cb(Object.assign(new Error("550 No such user"), { responseCode: 550 }))
      : cb(),
  onData: (stream, session, cb) => {
    let raw = "";
    stream.on("data", (c: Buffer) => (raw += c.toString()));
    stream.on("end", () => {
      inbox.push({
        from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
        to: session.envelope.rcptTo.map((r) => r.address),
        raw,
      });
      cb();
    });
  },
});
let port = 0;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(r)));

const header = (raw: string, name: string) =>
  new RegExp(`^${name}: (.+(?:\\r\\n[ \\t].+)*)`, "im")
    .exec(raw)?.[1]
    .replace(/\r\n[ \t]+/g, " ") ?? null;
/** the text part, quoted-printable decoded */
const text = (raw: string) =>
  raw
    .slice(raw.indexOf("\r\n\r\n") + 4)
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

const sender = {
  senderName: "Asha Rao",
  senderEmail: "asha@ledgerly.app",
  company: "Ledgerly Ltd",
  address: "12 MG Road, Bengaluru 560001, India",
  website: "https://ledgerly.app",
  dailyCap: 10,
};

describe("composing", () => {
  it("adds the footer and a List-Unsubscribe header, and threads follow-ups", () => {
    const out = compose(
      { to: "priya@bestapps.blog", toName: "Priya Nair", subject: "Ledgerly", body: "Hi Priya" },
      sender,
      { messageId: "<pitch@ledgerly.app>" },
    );
    expect(out).toMatchObject({
      from: '"Asha Rao" <asha@ledgerly.app>',
      to: '"Priya Nair" <priya@bestapps.blog>',
      replyTo: "asha@ledgerly.app",
      inReplyTo: "<pitch@ledgerly.app>",
      listUnsubscribe: "<mailto:asha@ledgerly.app?subject=unsubscribe>",
    });
    expect(out.text).toMatch(/^Hi Priya\n\n--\nAsha Rao, Ledgerly Ltd\n/);
    expect(out.text).toContain("12 MG Road");
    expect(out.messageId).toMatch(/^<[0-9a-f-]{36}@ledgerly\.app>$/);
  });

  it("knows which failures won't go away", () => {
    expect(isPermanent({ responseCode: 550 })).toBe(true);
    expect(isPermanent({ code: "EAUTH" })).toBe(true);
    expect(isPermanent({ code: "ECONNECTION" })).toBe(false);
    expect(isPermanent({ responseCode: 421 })).toBe(false);
  });
});

describe("sending", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  const DAY = 86_400_000;
  const t0 = new Date("2026-10-28T09:00:00Z");

  const addTarget = async (url: string, email: string) => {
    const [t] = await db
      .insert(schema.outreachTargets)
      .values({
        workspaceId,
        url,
        domain: new URL(url).hostname,
        title: "The 9 best invoicing apps",
        status: "ready",
        research: {
          kind: "list",
          opening: "The list names Zoho but not Ledgerly.",
          reason: "Ledgerly: invoicing software.",
          fit: true,
          namesBrand: false,
          rivalsOnPage: ["Zoho"],
          source: "rules",
        },
        contact: { email, name: null, source: "page", foundOn: url, role: "editorial" },
        evidence: { answers: 1, prompts: ["p"], engines: [], rivals: ["Zoho"], withYou: 0 },
      })
      .returning();
    return t.id;
  };
  const approved = async (url: string, email: string) => {
    const id = await addTarget(url, email);
    await draftPending(db, null, { limit: 10 });
    const r = await approve(db, workspaceId, id, "owner");
    if (!r.ok) throw new Error(r.problems.join(" "));
    return id;
  };
  const mailerFor = async (ws: string): Promise<Mailer | null> => {
    const smtp = await smtpOf(db, ws);
    return smtp ? smtpMailer(smtp, { plaintextForTests: true }) : null;
  };
  const target = async (id: string) =>
    (await db.select().from(schema.outreachTargets).where(eq(schema.outreachTargets.id, id)))[0];

  beforeEach(async () => {
    inbox.length = 0;
    refuse = null;
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db.insert(schema.workspaces).values({ name: "Send" }).returning();
    await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] });
    await saveSender(db, workspaceId, sender);
    expect(
      await saveSmtp(db, workspaceId, {
        host: "localhost.test",
        port,
        secure: false,
        user: "asha@ledgerly.app",
        password: "app-password",
      }),
    ).toEqual({ ok: true });
    // the saved host is a name; point it at the local server for the test
    await db
      .update(schema.outreachSettings)
      .set({ smtpHost: "127.0.0.1" })
      .where(eq(schema.outreachSettings.workspaceId, workspaceId));
  }, 60_000);

  it("keeps the password encrypted, and an empty password keeps the saved one", async () => {
    const [row] = await db.select().from(schema.outreachSettings);
    expect(row.smtpPassword).not.toContain("app-password");
    await saveSmtp(db, workspaceId, {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "asha@ledgerly.app",
    });
    expect(await smtpOf(db, workspaceId)).toMatchObject({
      host: "smtp.gmail.com",
      password: "app-password",
    });
    expect(
      await saveSmtp(db, workspaceId, { host: "not a host", port: 465, secure: true, user: "x" }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("sends an approved email over SMTP, then its follow-up a week later, in the same thread", async () => {
    const id = await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    // a second site, drafted but not approved: never sent
    await addTarget("https://other.blog/x", "hi@other.blog");
    await draftPending(db, null, { limit: 10 });

    expect(await sendDue(db, mailerFor, t0)).toEqual({
      sent: 1,
      waiting: 0,
      stopped: 0,
      failed: 0,
    });
    expect(inbox).toHaveLength(1);
    const [mail] = inbox;
    expect([mail.from, mail.to]).toEqual(["asha@ledgerly.app", ["editor@bestapps.blog"]]);
    // curly quotes make the subject an encoded word: =?UTF-8?Q?Ledgerly_for_=E2=80=9C…?=
    expect(header(mail.raw, "Subject")).toMatch(/^=\?UTF-8\?Q\?Ledgerly_for_/);
    expect(header(mail.raw, "List-Unsubscribe")).toBe(
      "<mailto:asha@ledgerly.app?subject=unsubscribe>",
    );
    expect(text(mail.raw)).toContain("12 MG Road, Bengaluru 560001, India");
    expect(text(mail.raw)).toContain(`Reply "unsubscribe"`);

    const { pitch, followUp } = await messagesOf(db, workspaceId, id);
    expect(pitch).toMatchObject({ status: "sent", sentAt: t0 });
    expect(header(mail.raw, "Message-ID")).toBe(pitch?.messageId);
    expect(followUp?.sendAfter).toEqual(new Date(t0.getTime() + 7 * DAY));
    expect((await target(id)).status).toBe("sent");

    // a day later: nothing; eight days later: the follow-up, replying to the pitch
    expect((await sendDue(db, mailerFor, new Date(t0.getTime() + DAY))).sent).toBe(0);
    expect((await sendDue(db, mailerFor, new Date(t0.getTime() + 8 * DAY))).sent).toBe(1);
    expect(inbox).toHaveLength(2);
    expect(header(inbox[1].raw, "In-Reply-To")).toBe(pitch?.messageId);
    expect(header(inbox[1].raw, "Subject")).toMatch(/^=\?UTF-8\?Q\?Re=3A_Ledgerly/);
    // the unapproved one never went
    expect(inbox.every((m) => !m.to.includes("hi@other.blog"))).toBe(true);
  });

  it("refuses a site on the do-not-contact list at the moment of sending", async () => {
    const id = await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    // added straight to the list, as an opt-out reply would, after approval
    await db
      .insert(schema.doNotContact)
      .values({ workspaceId, value: "bestapps.blog", reason: "opted out" });
    expect(await sendDue(db, mailerFor, t0)).toMatchObject({ sent: 0, stopped: 1 });
    expect(inbox).toHaveLength(0);
    const { pitch, followUp } = await messagesOf(db, workspaceId, id);
    expect([pitch?.status, followUp?.status]).toEqual(["cancelled", "cancelled"]);
    expect((await target(id)).note).toBe("Not sent: On the do-not-contact list.");
  });

  it("emails a site once a quarter, and no more than the daily cap", async () => {
    await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    const same = await approved("https://bestapps.blog/accounting", "editor@bestapps.blog");
    await approved("https://third.blog/x", "hi@third.blog");
    await db.update(schema.outreachSettings).set({ dailyCap: 1 });

    // the same site is refused for the quarter at once; the third site waits for tomorrow (cap 1)
    expect(await sendDue(db, mailerFor, t0)).toEqual({
      sent: 1,
      waiting: 1,
      stopped: 1,
      failed: 0,
    });
    const next = await sendDue(db, mailerFor, new Date(t0.getTime() + DAY));
    expect(next).toEqual({ sent: 1, waiting: 0, stopped: 0, failed: 0 });
    expect((await target(same)).note).toMatch(
      /bestapps\.blog was emailed on 2026-10-28; one email per site per quarter/,
    );
    expect(inbox.map((m) => m.to[0])).toEqual(["editor@bestapps.blog", "hi@third.blog"]);
  });

  it("marks a refused address as failed, with the reason, and can try again", async () => {
    const id = await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    refuse = "editor@bestapps.blog";
    expect(await sendDue(db, mailerFor, t0)).toMatchObject({ sent: 0, failed: 1 });
    const { pitch } = await messagesOf(db, workspaceId, id);
    expect(pitch?.status).toBe("failed");
    expect(pitch?.error).toMatch(/550/);

    refuse = null;
    await retry(db, workspaceId, id);
    expect((await sendDue(db, mailerFor, t0)).sent).toBe(1);
  });

  it("leaves a temporary failure approved, and waits before trying again", async () => {
    await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    let calls = 0;
    const flaky: Mailer = {
      verify: async () => {},
      send: async () => {
        calls++;
        throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });
      },
    };
    expect(await sendDue(db, async () => flaky, t0)).toMatchObject({ failed: 1 });
    expect(await sendDue(db, async () => flaky, new Date(t0.getTime() + 60_000))).toMatchObject({
      failed: 0,
    });
    expect(calls).toBe(1);
    const [m] = await db
      .select()
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.kind, "pitch"));
    expect([m.status, m.error]).toEqual(["approved", "Connection timeout"]);
  });

  it("waits for an SMTP login before sending anything", async () => {
    await approved("https://bestapps.blog/invoicing", "editor@bestapps.blog");
    await db.update(schema.outreachMessages).set({ error: "getaddrinfo ENOTFOUND old.host" });
    await removeSmtp(db, workspaceId);
    expect(await smtpOf(db, workspaceId)).toBeNull();
    // an old send error means nothing once the mailbox changes
    const [m] = await db
      .select()
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.kind, "pitch"));
    expect(m.error).toBeNull();
    expect(await sendDue(db, mailerFor, t0)).toMatchObject({ sent: 0, waiting: 1 });
    expect(inbox).toHaveLength(0);
  });
});
