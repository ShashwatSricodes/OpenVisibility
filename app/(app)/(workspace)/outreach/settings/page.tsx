import type { Metadata } from "next";
import { requireWorkspace } from "@/core/auth/session";
import { blockedList, getSender } from "@/core/outreach/pitch";
import { imapInfo } from "@/core/outreach/replies";
import { mailboxInfo } from "@/core/outreach/send";
import { getDb } from "@/db/client";
import { Page } from "../../../_components/page-frame";
import { DoNotContact, ImapSettings, MailboxSettings, SenderSettings } from "../review";

export const metadata: Metadata = { title: "Outreach settings" };

export default async function OutreachSettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [sender, blocked, mailbox] = await Promise.all([
    getSender(db, workspace.id),
    blockedList(db, workspace.id),
    mailboxInfo(db, workspace.id),
  ]);
  const imap = await imapInfo(db, workspace.id);
  const owner = role === "owner";
  return (
    <Page
      title="Outreach settings"
      description="Who emails come from, and who never to email"
      width="narrow"
    >
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Sender</h2>
        <SenderSettings
          canEdit={owner}
          initial={{
            senderName: sender?.senderName ?? "",
            senderEmail: sender?.senderEmail ?? "",
            company: sender?.company ?? "",
            address: sender?.address ?? "",
            website: sender?.website ?? "",
            dailyCap: sender?.dailyCap ?? 10,
          }}
        />
      </section>
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
        <div>
          <h2 className="text-sm font-semibold">Your mailbox</h2>
          <p className="text-xs text-fg-subtle">
            Approved emails go out from here, so replies land in your normal inbox. Until it&rsquo;s
            set up, approved emails wait.
          </p>
        </div>
        <MailboxSettings
          canEdit={owner}
          hasPassword={mailbox.hasPassword}
          initial={{
            host: mailbox.host,
            port: mailbox.port,
            secure: mailbox.secure,
            user: mailbox.user || (sender?.senderEmail ?? ""),
          }}
        />
      </section>
      {mailbox.ready && (
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
          <div>
            <h2 className="text-sm font-semibold">Replies</h2>
            <p className="text-xs text-fg-subtle">
              While emails are out, the agent reads your inbox every ten minutes, with the same
              login, without marking anything as read. Replies stop the follow-up and show on the
              Outreach page; &ldquo;unsubscribe&rdquo; replies go on your do-not-contact list.{" "}
              {imap.error
                ? `The last read failed: ${imap.error}.`
                : imap.checked
                  ? `Last read ${imap.checked.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC.`
                  : "Not read yet."}
            </p>
          </div>
          <ImapSettings
            canEdit={owner}
            guessed={imap.guessed}
            initial={{ host: imap.host, port: imap.port }}
          />
        </section>
      )}
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
        <div>
          <h2 className="text-sm font-semibold">Do not contact</h2>
          <p className="text-xs text-fg-subtle">
            Addresses and whole domains the agent never emails. Adding one stops anything already
            waiting for it.
          </p>
        </div>
        <DoNotContact items={blocked} canEdit={owner} />
      </section>
    </Page>
  );
}
