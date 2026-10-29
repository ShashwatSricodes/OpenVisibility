import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getCredentialInfo } from "@/core/credentials";
import { env } from "@/core/env";
import { BRIGHT_DATA_PRICING, ENGINES } from "@/core/providers/registry";
import { getSchedule } from "@/core/runs/schedule";
import { getSavings } from "@/core/savings";
import { getTrackingConfig } from "@/core/tracking-config";
import { estimateWorkspaceRun, getFreeTierUsage } from "@/core/usage";
import { getDb } from "@/db/client";
import { BrightDataKeyForm, type KeyStatus } from "./key-form";
import { Page } from "../../_components/page-frame";
import { SavingsForm } from "./savings-form";
import { ScheduleForm } from "./schedule-form";
import { TrackingForm } from "./tracking-form";
import { UsageSection } from "./usage-section";
import { ApiKeys } from "./api-keys";
import { listKeys } from "@/core/mcp/keys";

export const metadata: Metadata = { title: "Settings" };

const brightDataEngines = Object.values(ENGINES)
  .filter((e) => e.provider === "brightdata" && e.status === "available")
  .map((e) => e.name);

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

export default async function SettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  // site keys (they only report visits) are managed on the AI traffic page
  const apiKeys = (await listKeys(getDb(), workspace.id)).flatMap((k) =>
    k.access === "ingest" ? [] : [{ ...k, access: k.access }],
  );
  const [info, tracking, usage, estimate, schedule, savings] = await Promise.all([
    getCredentialInfo(db, workspace.id),
    getTrackingConfig(db, workspace.id),
    getFreeTierUsage(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
    getSchedule(db, workspace.id),
    getSavings(db, workspace.id),
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

      <UsageSection
        usage={usage}
        estimate={estimate}
        config={tracking}
        cap={workspace.monthlyAnswerCap}
        canEdit={role === "owner"}
      />

      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">Schedule</h2>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Run every active prompt automatically. A run that would go past your monthly limit, or
            starts while the last one is still going, is skipped and listed on the Runs page.
          </p>
        </div>
        <ScheduleForm
          schedule={schedule}
          answersPerRun={estimate.answers}
          cap={workspace.monthlyAnswerCap}
          canEdit={role === "owner"}
        />
      </section>

      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">Saving answers</h2>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Two ways to pay for fewer Bright Data answers. Both are off until you turn them on.
          </p>
        </div>
        <SavingsForm savings={savings} samples={tracking.samples} canEdit={role === "owner"} />
      </section>

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

      <section className="rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">API keys and MCP</h2>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Connect Claude, ChatGPT, Cursor or any MCP client to this workspace: ask how visible you
            are, who beats you and what to do, from the assistant you already use.
          </p>
        </div>
        <ApiKeys
          keys={apiKeys}
          endpoint={`${env().BETTER_AUTH_URL.replace(/\/$/, "")}/api/mcp`}
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
