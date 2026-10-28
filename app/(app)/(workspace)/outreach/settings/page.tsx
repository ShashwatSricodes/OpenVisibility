import type { Metadata } from "next";
import { requireWorkspace } from "@/core/auth/session";
import { blockedList, getSender } from "@/core/outreach/pitch";
import { mailboxInfo } from "@/core/outreach/send";
import { getDb } from "@/db/client";
import { Page } from "../../../_components/page-frame";
import { DoNotContact, MailboxSettings, SenderSettings } from "../review";

export const metadata: Metadata = { title: "Outreach settings" };

export default async function OutreachSettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [sender, blocked, mailbox] = await Promise.all([
    getSender(db, workspace.id),
    blockedList(db, workspace.id),
    mailboxInfo(db, workspace.id),
  ]);
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
