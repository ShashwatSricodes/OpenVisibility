import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { workspaceCounts } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Citations" };

export default async function CitationsPage() {
  const { workspace } = await requireWorkspace();
  const counts = await workspaceCounts(getDb(), workspace.id);

  return (
    <Page title="Citations" description="The pages AI engines cite when they answer your prompts">
      <EmptyState
        icon={<Link2 />}
        title="No citations yet"
        description={
          counts.answers
            ? "Citations from your stored answers will be grouped by domain and page here."
            : "After your first run, this shows which domains and pages the engines cite: yours, your competitors', and the review sites in between. Those are the pages worth getting onto."
        }
        action={counts.answers ? undefined : { href: "/runs", label: "See runs" }}
      />
    </Page>
  );
}
