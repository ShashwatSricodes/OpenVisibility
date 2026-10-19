import type { Metadata } from "next";
import Link from "next/link";
import { Logotype } from "@/components/brand/Logo";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { getDb } from "@/db/client";
import { Wizard } from "./wizard";

export const metadata: Metadata = { title: "Set up your brand" };

/* Full-screen setup, outside the sidebar layout. Also the place to edit the brand later. */
export default async function OnboardingPage() {
  const { workspace, role } = await requireWorkspace();
  const { brand, competitors } = await getBrandSetup(getDb(), workspace.id);

  return (
    <div className="min-h-screen bg-frame">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logotype
          id="onboarding"
          height={16}
          textClassName="font-display text-[14px] font-semibold tracking-tight"
        />
        {brand && (
          <Link href="/dashboard" className="text-[13px] text-fg-subtle hover:text-fg">
            Back to {workspace.name}
          </Link>
        )}
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
        <Wizard
          initialBrand={
            brand
              ? {
                  name: brand.name,
                  description: brand.description ?? "",
                  domains: brand.domains,
                  aliases: brand.aliases,
                }
              : null
          }
          initialCompetitors={competitors.map(({ name, domains, aliases }) => ({
            name,
            domains,
            aliases,
          }))}
          canEdit={role === "owner"}
        />
      </main>
    </div>
  );
}
