import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Billing" };

/* Hosted workspaces only: self-hosted ones pay Bright Data directly with their own key. */
export default async function BillingPage() {
  const { workspace } = await requireWorkspace();
  if (workspace.mode !== "hosted") notFound();

  return (
    <Page title="Billing" description="Your prepaid wallet and what each run cost" width="narrow">
      <EmptyState
        icon={<CreditCard />}
        title="Wallet coming soon"
        description="You'll top up a prepaid wallet and pay only for the answers your runs use, at cost plus a small margin. Nothing is charged until then."
      />
    </Page>
  );
}
