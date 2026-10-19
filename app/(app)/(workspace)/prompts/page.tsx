import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { listBrandPrompts } from "@/core/prompts";
import { getTrackingConfig } from "@/core/tracking-config";
import { getDb } from "@/db/client";
import { EmptyState, Page, buttonSecondary } from "../../_components/page-frame";
import { PromptManager } from "./prompt-manager";

export const metadata: Metadata = { title: "Prompts" };

export default async function PromptsPage() {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [{ brand }, config] = await Promise.all([
    getBrandSetup(db, workspace.id),
    getTrackingConfig(db, workspace.id),
  ]);
  const rows = brand ? await listBrandPrompts(db, brand.id) : [];
  const active = rows.filter((p) => p.active).length;

  return (
    <Page
      title="Prompts"
      description={
        rows.length
          ? `${active} active of ${rows.length} · the questions each run asks every engine`
          : "The questions each run asks every engine"
      }
      actions={
        brand && role === "owner" ? (
          <Link href="/onboarding?step=prompts" className={buttonSecondary}>
            <Sparkles className="size-3.5" />
            Get suggestions
          </Link>
        ) : undefined
      }
    >
      {!brand ? (
        <EmptyState
          icon={<ListChecks />}
          title="Set up your brand first"
          description="Prompts are the questions your customers ask AI, like “best invoicing app for freelancers”. Setup suggests them from your brand, category and competitors."
          action={{ href: "/onboarding", label: "Set up your brand" }}
        />
      ) : (
        <PromptManager
          prompts={rows.map(({ id, text, tags, countries, active }) => ({
            id,
            text,
            tags,
            countries,
            active,
          }))}
          defaultCountries={config.countries}
          canEdit={role === "owner"}
        />
      )}
    </Page>
  );
}
