"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Pencil, TriangleAlert } from "lucide-react";
import { countryName } from "@/core/countries";
import type { FreeTierCheck } from "@/core/estimate";
import { ENGINES } from "@/core/providers/registry";
import { buttonPrimary, buttonSecondary } from "../_components/page-frame";
import { reviewAction, type Review } from "./actions";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const list = new Intl.ListFormat("en", { type: "conjunction" });

function Row({
  label,
  children,
  edit,
}: {
  label: string;
  children: React.ReactNode;
  edit: { label: string; onClick?: () => void; href?: string };
}) {
  const editClass =
    "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-fg-subtle hover:bg-hover hover:text-fg";
  return (
    <div className="flex items-start gap-4 px-5 py-3.5">
      <dt className="w-28 shrink-0 text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-fg">{children}</dd>
      {edit.href ? (
        <Link href={edit.href} className={editClass} aria-label={edit.label}>
          <Pencil className="size-3" />
          Edit
        </Link>
      ) : (
        <button type="button" onClick={edit.onClick} className={editClass} aria-label={edit.label}>
          <Pencil className="size-3" />
          Edit
        </button>
      )}
    </div>
  );
}

function Fit({ check, label }: { check: FreeTierCheck; label: string }) {
  return check.fits ? (
    <p className="flex items-start gap-1.5 text-xs text-fg-default">
      <CheckCircle2 className="mt-px size-3.5 shrink-0 text-good" />
      {label} fits in your free answers, leaving {n(check.after)} this month.
    </p>
  ) : (
    <p className="flex items-start gap-1.5 text-xs text-fg-default">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--series-4)]" />
      {label} goes {plural(check.overBy, "answer")} past your free tier (about $
      {check.costUsd.toFixed(2)} at Bright Data&rsquo;s pay-as-you-go price). Pause some prompts,
      track fewer engines, or ask each prompt fewer times.
    </p>
  );
}

export function ReviewStep({ goTo }: { goTo: (step: number) => void }) {
  const router = useRouter();
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [, start] = useTransition();

  useEffect(() => {
    start(async () => setReview(await reviewAction()));
  }, []);

  if (review === undefined)
    return <p className="py-10 text-center text-[13px] text-fg-subtle">Loading your setup…</p>;
  if (review === null)
    return <p className="py-10 text-center text-[13px] text-fg-subtle">Save your brand first.</p>;

  const { brand, config } = review;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">Check everything before the first run</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          This is what every run will ask, and what it uses. You can change any of it later.
        </p>
      </div>

      <dl className="divide-y divide-line rounded-xl border border-line bg-panel">
        <Row label="Brand" edit={{ label: "Edit brand", onClick: () => goTo(0) }}>
          <span className="font-medium">{brand.name}</span>
          <span className="text-fg-subtle">
            {" "}
            · {brand.category}
            {brand.audience && ` for ${brand.audience}`}
          </span>
          {brand.domains.length > 0 && (
            <span className="block text-xs text-fg-subtle">{brand.domains.join(", ")}</span>
          )}
        </Row>
        <Row label="Competitors" edit={{ label: "Edit competitors", onClick: () => goTo(1) }}>
          {review.competitors.length ? (
            list.format(review.competitors)
          ) : (
            <span className="text-fg-subtle">
              None yet: you&rsquo;ll see your own visibility only
            </span>
          )}
        </Row>
        <Row label="Prompts" edit={{ label: "Edit prompts", href: "/prompts" }}>
          {plural(review.prompts.active, "active prompt")}
          <span className="text-fg-subtle">
            {" "}
            · {review.prompts.nonBranded} don&rsquo;t name {brand.name}
          </span>
        </Row>
        <Row label="Engines" edit={{ label: "Edit engines", href: "/settings" }}>
          {list.format(config.engines.map((e) => ENGINES[e].name))}
        </Row>
        <Row label="Countries" edit={{ label: "Edit countries", href: "/settings" }}>
          {list.format(config.countries.map(countryName))}
        </Row>
        <Row label="Each prompt" edit={{ label: "Edit times asked", href: "/settings" }}>
          asked {config.samples}× per engine and country
        </Row>
      </dl>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel px-5 py-4">
        <p className="text-[13px]">
          <span className="font-semibold">{plural(review.answersPerRun, "answer")}</span>
          <span className="text-fg-subtle"> per run, from Bright Data.</span>
        </p>
        {review.usage.used === null ? (
          <p className="text-xs text-fg-subtle">
            {review.usage.keySource
              ? "Couldn't check your free-tier usage right now."
              : "Add a Bright Data key in Settings before the first run."}
          </p>
        ) : (
          <>
            <p className="text-xs text-fg-subtle">
              {n(review.usage.used)} of {n(review.usage.limit)} free answers used this month.
            </p>
            {review.oneRun && <Fit check={review.oneRun} label="One run" />}
            {review.daily && (
              <Fit
                check={review.daily}
                label={`Running daily until the reset (${plural(review.daysLeft, "run")})`}
              />
            )}
          </>
        )}
        {review.warnings.map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-fg-default">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--series-4)]" />
            {w}
          </p>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => goTo(2)} className={buttonSecondary}>
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <button type="button" onClick={() => router.push("/dashboard")} className={buttonPrimary}>
          Finish setup
        </button>
      </div>
    </div>
  );
}
