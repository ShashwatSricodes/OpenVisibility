import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  approve,
  block,
  draftByModel,
  draftByTemplate,
  draftPending,
  dueMessages,
  footerOf,
  isBlocked,
  messageProblems,
  messagesOf,
  saveMessage,
  saveSender,
  senderProblems,
  skipPitch,
  unapprove,
  type Sender,
} from "./pitch";
import type { Brand, Research } from "./research";

const brand: Brand = {
  name: "Ledgerly",
  description: "invoicing with UPI and GST built in",
  category: "invoicing software",
  audience: "Indian freelancers",
  domains: ["ledgerly.app"],
};
const sender: Sender = {
  senderName: "Asha Rao",
  senderEmail: "asha@ledgerly.app",
  company: "Ledgerly Ltd",
  address: "12 MG Road, Bengaluru 560001, India",
  website: "https://ledgerly.app",
  dailyCap: 10,
};
const research: Research = {
  kind: "list",
  opening: "The list names Zoho and FreshBooks but not Ledgerly.",
  reason: "Ledgerly: invoicing with UPI and GST built in, for Indian freelancers.",
  fit: true,
  namesBrand: false,
  rivalsOnPage: ["Zoho", "FreshBooks"],
  source: "rules",
};
const target = {
  url: "https://bestapps.blog/invoicing",
  domain: "bestapps.blog",
  title: "The 9 best invoicing apps",
  research,
  contact: {
    email: "priya@bestapps.blog",
    name: "Priya Nair",
    source: "page" as const,
    foundOn: "https://bestapps.blog/invoicing",
    role: "author" as const,
  },
  evidence: {
    answers: 3,
    prompts: ["best invoicing app"],
    engines: ["chatgpt"],
    rivals: ["Zoho"],
    withYou: 0,
  },
};

describe("writing the pitch", () => {
  it("is specific to the page and claims only what the setup says", () => {
    const p = draftByTemplate(target, brand, sender);
    expect(p.pitch.subject).toBe("Ledgerly for “The 9 best invoicing apps”");
    expect(p.pitch.body).toBe(
      [
        "Hi Priya,",
        "I read “The 9 best invoicing apps”. It covers Zoho and FreshBooks, but not Ledgerly.",
        "Ledgerly is invoicing with UPI and GST built in, for Indian freelancers. If it's useful to your readers, I'm happy to send details, screenshots or an account to try it yourself.",
        "Would you consider adding Ledgerly to the list?",
        "Thanks,\nAsha",
      ].join("\n\n"),
    );
    expect(p.followUp.subject).toBe("Re: Ledgerly for “The 9 best invoicing apps”");
    expect(p.followUp.body).toMatch(/^Hi Priya,\n\nFollowing up on my note about Ledgerly/);
    expect(messageProblems({ to: "priya@bestapps.blog", ...p.pitch }, [])).toEqual([]);
  });

  it("ends every email with the sender, the postal address and a way out", () => {
    expect(footerOf(sender)).toBe(
      [
        "--",
        "Asha Rao, Ledgerly Ltd",
        "https://ledgerly.app",
        "12 MG Road, Bengaluru 560001, India",
        `Not interested? Reply "unsubscribe" and we won't email you again.`,
      ].join("\n"),
    );
  });

  it("uses the model's words when there is one, with the rules in the prompt", async () => {
    let prompt = "";
    const model = new MockLanguageModelV4({
      doGenerate: async (o) => {
        prompt = JSON.stringify(o.prompt);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                subject: "Ledgerly for your invoicing list",
                body: "Hi Priya,\n\nYour list of 9 invoicing apps skips Ledgerly...\n\nThanks,\nAsha",
                followUpBody: "Hi Priya, just checking you saw my note. No worries if not.",
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 150, text: 150, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const p = await draftByModel(
      { model, batch: 5, priceInput: 0.1, priceOutput: 0.4 },
      target,
      brand,
      sender,
    );
    expect(p).toMatchObject({
      source: "model",
      followUp: { subject: "Re: Ledgerly for your invoicing list" },
    });
    expect(prompt).toContain("never invent features");
    expect(prompt).toContain("no links");
  });

  it("refuses placeholders, bad addresses and anyone on the do-not-contact list", () => {
    const ok = { to: "priya@bestapps.blog", subject: "Hi", body: "Hello" };
    expect(messageProblems({ ...ok, body: "Hi [Name], …" }, [])).toEqual([
      "Fill in the placeholder left in the text.",
    ]);
    expect(messageProblems({ ...ok, to: "priya@" }, [])).toEqual([
      "The recipient's address isn't valid.",
    ]);
    expect(messageProblems(ok, ["bestapps.blog"])).toHaveLength(1);
    expect(isBlocked("ed@news.bestapps.blog", ["bestapps.blog"])).toBe(true);
    expect(isBlocked("priya@bestapps.blog", ["ed@bestapps.blog"])).toBe(false);
    expect(senderProblems({ ...sender, address: " " })).toEqual([
      "Add your company's postal address; every email must show one.",
    ]);
    expect(senderProblems(null)).toHaveLength(1);
  });
});

describe("the review queue", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  let targetId: string;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Pitch" })
      .returning();
    await db.insert(schema.brands).values({ workspaceId, ...brand });
    [{ id: targetId }] = await db
      .insert(schema.outreachTargets)
      .values({
        workspaceId,
        url: target.url,
        domain: target.domain,
        title: target.title,
        status: "ready",
        research: target.research,
        contact: target.contact,
        evidence: target.evidence,
      })
      .returning();
  }, 60_000);

  const status = async () =>
    (
      await db.select().from(schema.outreachTargets).where(eq(schema.outreachTargets.id, targetId))
    )[0].status;

  it("drafts, and nothing is sendable until a person approves", async () => {
    expect(await draftPending(db, null)).toBe(1);
    expect(await draftPending(db, null)).toBe(0); // once per target
    expect(await status()).toBe("drafted");
    const { pitch, followUp } = await messagesOf(db, workspaceId, targetId);
    expect([pitch?.status, followUp?.status, pitch?.to]).toEqual([
      "draft",
      "draft",
      "priya@bestapps.blog",
    ]);
    expect(await dueMessages(db)).toEqual([]);

    // written before the sender was known: signed with a placeholder, and approval is refused
    expect(pitch?.body.endsWith("Thanks,\n[your name]")).toBe(true);
    const refused = await approve(db, workspaceId, targetId, "owner@ledgerly.app");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok === false && refused.problems).toEqual([
      "Add your name, email and company's postal address in outreach settings.",
      "Fill in the placeholder left in the text.",
      "Follow-up: Fill in the placeholder left in the text.",
    ]);

    // saving the sender signs the waiting drafts
    await saveSender(db, workspaceId, sender);
    const signed = await messagesOf(db, workspaceId, targetId);
    expect(signed.pitch?.body.endsWith("Thanks,\nAsha")).toBe(true);
    expect(signed.followUp?.body.endsWith("Thanks,\nAsha")).toBe(true);
    expect(await approve(db, workspaceId, targetId, "owner@ledgerly.app")).toEqual({ ok: true });
    expect(await status()).toBe("approved");
    // the pitch can go; the follow-up waits for the pitch to be sent
    expect((await dueMessages(db)).map((m) => m.kind)).toEqual(["pitch"]);

    // editing an approved email takes the approval back
    expect(
      await saveMessage(db, workspaceId, pitch!.id, { subject: "Ledgerly", body: "Hi Priya, …" }),
    ).toEqual({ ok: true, unapproved: true });
    expect(await dueMessages(db)).toEqual([]);
    await approve(db, workspaceId, targetId, "owner@ledgerly.app");
    await unapprove(db, workspaceId, targetId);
    expect([await status(), (await dueMessages(db)).length]).toEqual(["drafted", 0]);
  });

  it("stops waiting emails when the address is blocked, and when you skip", async () => {
    await draftPending(db, null);
    await saveSender(db, workspaceId, sender);
    await approve(db, workspaceId, targetId, "owner");
    expect(await block(db, workspaceId, "https://www.bestapps.blog/about", "test")).toEqual({
      ok: true,
      value: "bestapps.blog",
    });
    const { pitch } = await messagesOf(db, workspaceId, targetId);
    expect(pitch?.status).toBe("cancelled");
    expect(await dueMessages(db)).toEqual([]);
    expect(await block(db, workspaceId, "nothing", "test")).toMatchObject({ ok: false });

    await skipPitch(db, workspaceId, targetId);
    expect(await status()).toBe("skipped");
  });

  it("doesn't draft to an address that's already blocked", async () => {
    await block(db, workspaceId, "priya@bestapps.blog", "opted out");
    await draftPending(db, null);
    expect(await status()).toBe("skipped");
    expect((await messagesOf(db, workspaceId, targetId)).pitch).toBeNull();
  });
});
