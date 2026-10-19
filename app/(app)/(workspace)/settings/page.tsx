import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getCredentialInfo } from "@/core/credentials";
import { env } from "@/core/env";
import { BRIGHT_DATA_PRICING, ENGINES } from "@/core/providers/registry";
import { getTrackingConfig } from "@/core/tracking-config";
import { estimateWorkspaceRun, getFreeTierUsage } from "@/core/usage";
import { getDb } from "@/db/client";
import { BrightDataKeyForm, type KeyStatus } from "./key-form";
import { Page } from "../../_components/page-frame";
import { TrackingForm } from "./tracking-form";
import { UsageSection } from "./usage-section";

export const metadata: Metadata = { title: "Settings" };

const brightDataEngines = Object.values(ENGINES)
  .filter((e) => e.provider === "brightdata" && e.status === "available")
  .map((e) => e.name);

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

export default async function SettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const [info, tracking, usage, estimate] = await Promise.all([
    getCredentialInfo(db, workspace.id),
    getTrackingConfig(db, workspace.id),
    getFreeTierUsage(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
  ]);

  const status: KeyStatus = info
    ? {
        kind: "workspace",
        last4: info.last4,
        addedAt: info.createdAt.toISOString(),
        verifiedAt: info.verifiedAt?.toISOString() ?? null,
      }
    : env().BRIGHT_DATA_API_KEY
      ? { kind: "server" }
      : { kind: "none" };

  return (
    <Page title="Settings" description={workspace.name} width="narrow">
      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">Bright Data API key</h2>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Answers from {listFormat.format(brightDataEngines)} come from Bright Data, which asks
            each prompt in the real apps. A free account includes{" "}
            {BRIGHT_DATA_PRICING.freeAnswersPerMonth.toLocaleString("en-US")} answers a month.{" "}
            <a
              href="https://brightdata.com/cp/setting/users"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-fg-default underline decoration-line-strong underline-offset-2 hover:text-fg"
            >
              Get your key
              <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
        <div className="px-5 py-4">
          <BrightDataKeyForm status={status} canEdit={role === "owner"} />
        </div>
      </section>

      <UsageSection usage={usage} estimate={estimate} config={tracking} />

      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">What to track</h2>
          <p className="mt-1 text-[13px] text-fg-subtle">
            The AI engines and countries every run covers. Engines marked &ldquo;Not yet&rdquo; have
            no working data source; they&rsquo;ll be added as sources become available.
          </p>
        </div>
        <TrackingForm
          engines={tracking.engines}
          countries={tracking.countries}
          samples={tracking.samples}
          canEdit={role === "owner"}
        />
      </section>

      <p className="text-[11px] text-fg-muted">
        Keys are encrypted before they&rsquo;re stored and are never sent back to your browser. Only
        the last four characters are shown.
      </p>
    </Page>
  );
}
