import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { workspaceCounts } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Answers" };

export default async function AnswersPage() {
  const { workspace } = await requireWorkspace();
  const counts = await workspaceCounts(getDb(), workspace.id);

  return (
    <Page
      title="Answers"
      description="Every answer the engines gave, word for word, with its sources"
    >
      {/* the answer archive is Day 29; until runs exist there is nothing to list */}
      <EmptyState
        icon={<MessageSquareText />}
        title={counts.answers ? `${counts.answers} answers stored` : "No answers yet"}
        description={
          counts.answers
            ? "The answer archive, with search and filters, is on its way."
            : "Answers appear here after your first run: the full text from each engine, where your brand and competitors were mentioned, and the sources cited."
        }
        action={counts.answers ? undefined : { href: "/runs", label: "See runs" }}
      />
    </Page>
  );
}
