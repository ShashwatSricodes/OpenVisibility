"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import {
  MAX_COMPETITORS,
  isDomain,
  normalizeDomain,
  type BrandInput,
  type CompetitorInput,
} from "@/core/brand-setup";
import { ChipsInput } from "../_components/chips-input";
import { buttonPrimary, buttonSecondary } from "../_components/page-frame";
import { cn } from "../_lib/cn";
import { saveBrandAction, saveCompetitorsAction } from "./actions";
import { PromptsStep } from "./prompts-step";

const STEPS = ["Brand", "Competitors", "Prompts"] as const;

const domainCheck = (v: string) =>
  isDomain(v) ? null : `"${v}" isn't a domain, like example.com.`;

const input =
  "h-8 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-line-strong focus:ring-2 focus:ring-line";

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-[11px] font-medium",
              i < step && "border-inverted bg-inverted text-on-inverted",
              i === step && "border-fg text-fg",
              i > step && "border-line-strong text-fg-muted",
            )}
          >
            {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-fg" : "text-fg-subtle")}>{label}</span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-line-strong" />}
        </li>
      ))}
    </ol>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-[13px] text-bad">
      <CircleAlert className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

const blankCompetitor = (): CompetitorInput => ({ name: "", domains: [], aliases: [] });

export function Wizard({
  initialBrand,
  initialCompetitors,
  canEdit,
  initialStep = 0,
}: {
  initialBrand: BrandInput | null;
  initialCompetitors: CompetitorInput[];
  canEdit: boolean;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [brand, setBrand] = useState<BrandInput>(
    initialBrand ?? {
      name: "",
      category: "",
      audience: "",
      description: "",
      domains: [],
      aliases: [],
    },
  );
  const [competitors, setCompetitors] = useState<CompetitorInput[]>(
    initialCompetitors.length
      ? initialCompetitors
      : [blankCompetitor(), blankCompetitor(), blankCompetitor()],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [promptTotal, setPromptTotal] = useState(0);
  const [pending, start] = useTransition();
  const brandName = brand.name.trim() || "your brand";

  const saveBrand = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveBrandAction(brand);
      if (!r.ok) return setProblem(r.message);
      setProblem(null);
      setStep(1);
    });
  };

  const saveCompetitors = (e: React.FormEvent) => {
    e.preventDefault();
    // blank rows are just unused slots
    const filled = competitors.filter((c) => c.name.trim() || c.domains.length || c.aliases.length);
    start(async () => {
      const r = await saveCompetitorsAction(filled);
      if (!r.ok) return setProblem(r.message);
      setProblem(null);
      setCompetitors(filled.length ? filled : [blankCompetitor()]);
      setStep(2);
    });
  };

  const update = (i: number, patch: Partial<CompetitorInput>) =>
    setCompetitors((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-6">
      <Stepper step={step} />

      {!canEdit && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-xs text-fg-default">
          Only the workspace owner can change the brand and competitors.
        </p>
      )}

      {step === 0 && (
        <form onSubmit={saveBrand} className="flex flex-col gap-5">
          <div>
            <h1 className="text-lg font-semibold">Which brand are you tracking?</h1>
            <p className="mt-1 text-[13px] text-fg-subtle">
              We look for it by name in every answer, and count citations to its domains as your
              own.
            </p>
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-default">Brand name</span>
              <input
                required
                autoFocus
                disabled={!canEdit}
                value={brand.name}
                onChange={(e) => setBrand({ ...brand, name: e.target.value })}
                placeholder="Ledgerly"
                className={input}
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-default">Category</span>
                <input
                  required
                  disabled={!canEdit}
                  value={brand.category}
                  onChange={(e) => setBrand({ ...brand, category: e.target.value })}
                  placeholder="invoicing software"
                  className={input}
                />
                <span className="text-xs text-fg-muted">
                  What people would search for, in lowercase.
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-default">Who it&rsquo;s for</span>
                <input
                  disabled={!canEdit}
                  value={brand.audience ?? ""}
                  onChange={(e) => setBrand({ ...brand, audience: e.target.value })}
                  placeholder="freelancers and small agencies"
                  className={input}
                />
                <span className="text-xs text-fg-muted">Optional.</span>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-default">What it does</span>
              <textarea
                rows={2}
                maxLength={280}
                disabled={!canEdit}
                value={brand.description ?? ""}
                onChange={(e) => setBrand({ ...brand, description: e.target.value })}
                placeholder="Invoicing and GST billing software for freelancers and small agencies."
                className={cn(input, "h-auto py-2 leading-snug")}
              />
              <span className="text-xs text-fg-muted">
                One sentence. It&rsquo;s used to suggest the questions your customers ask AI.
              </span>
            </label>

            <ChipsInput
              label="Websites you own"
              value={brand.domains}
              onChange={(domains) => setBrand({ ...brand, domains })}
              normalize={normalizeDomain}
              check={domainCheck}
              placeholder="ledgerly.app"
              hint="Paste a URL or a domain; we keep just the domain."
              disabled={!canEdit}
            />

            <ChipsInput
              label="Other names it goes by"
              value={brand.aliases}
              onChange={(aliases) => setBrand({ ...brand, aliases })}
              placeholder="Ledgerly Invoicing"
              hint="Spellings, product names or abbreviations AI might use instead."
              disabled={!canEdit}
            />
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-line bg-hover px-3 py-2.5 text-xs text-fg-default">
            <Info className="mt-px size-3.5 shrink-0 text-fg-subtle" />
            We ask each engine your questions as a logged-out visitor, through Bright Data.
            Signed-in or paying users may see different answers, so treat results as a strong
            signal, not an exact copy of what every customer sees.
          </p>

          <Problem message={problem} />
          <div className="flex justify-end">
            <button type="submit" disabled={pending || !canEdit} className={buttonPrimary}>
              {pending ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={saveCompetitors} className="flex flex-col gap-5">
          <div>
            <h1 className="text-lg font-semibold">Who do customers compare {brandName} with?</h1>
            <p className="mt-1 text-[13px] text-fg-subtle">
              Add the brands you lose deals to. Every run counts how often AI names them next to
              you, and which sources it cites for them. Three to five is a good start.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {competitors.map((c, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4"
              >
                <div className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-fg-default">
                      Competitor {i + 1}
                    </span>
                    <input
                      value={c.name}
                      disabled={!canEdit}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder={["Zoho Invoice", "FreshBooks", "Wave"][i] ?? "Name"}
                      className={input}
                    />
                  </label>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove competitor ${i + 1}`}
                      onClick={() =>
                        setCompetitors((list) =>
                          list.length > 1 ? list.filter((_, j) => j !== i) : [blankCompetitor()],
                        )
                      }
                      className={cn(buttonSecondary, "w-8 px-0 text-fg-subtle hover:text-bad")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ChipsInput
                    label="Websites"
                    value={c.domains}
                    onChange={(domains) => update(i, { domains })}
                    normalize={normalizeDomain}
                    check={domainCheck}
                    placeholder={i === 0 ? "zoho.com" : "Optional"}
                    disabled={!canEdit}
                  />
                  <ChipsInput
                    label="Other names"
                    value={c.aliases}
                    onChange={(aliases) => update(i, { aliases })}
                    placeholder={i === 0 ? "Zoho" : "Optional"}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ))}
          </div>

          {canEdit && competitors.length < MAX_COMPETITORS && (
            <button
              type="button"
              onClick={() => setCompetitors((list) => [...list, blankCompetitor()])}
              className={cn(buttonSecondary, "self-start")}
            >
              <Plus className="size-3.5" />
              Add competitor
            </button>
          )}

          {initialCompetitors.length > 0 && (
            <p className="text-xs text-fg-muted">
              Removing a competitor also removes its history from past runs.
            </p>
          )}

          <Problem message={problem} />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setStep(0);
              }}
              className={buttonSecondary}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
            <button type="submit" disabled={pending || !canEdit} className={buttonPrimary}>
              {pending ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <PromptsStep
          brandName={brandName}
          canEdit={canEdit}
          onBack={() => setStep(1)}
          onDone={(total) => {
            setPromptTotal(total);
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel px-6 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-pressed">
            <Check className="size-4 text-good" strokeWidth={2.5} />
          </span>
          <h1 className="text-base font-semibold">{brandName} is set up</h1>
          <p className="max-w-md text-[13px] text-fg-subtle">
            {competitors.filter((c) => c.name.trim()).length} competitors and {promptTotal} prompts
            are saved. Next, check which engines and countries to track; runs start from there.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/settings" className={buttonPrimary}>
              Engines and countries
            </Link>
            <Link href="/prompts" className={buttonSecondary}>
              See prompts
            </Link>
            <button type="button" onClick={() => setStep(0)} className={buttonSecondary}>
              Edit again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
