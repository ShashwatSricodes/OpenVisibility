import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Recommendation } from "@/core/gaps";

const KIND = {
  gap: "Content gap",
  target: "Get cited",
  page: "Your site",
  slipping: "Trend",
} as const;

/** One next step: what to do, and the numbers that say why. */
export function RecommendationItem({ r, n }: { r: Recommendation; n?: number }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs text-fg-subtle">
        {n !== undefined && <span className="tabular font-medium text-fg">{n}.</span>}
        <span className="rounded bg-pressed px-1.5 py-px text-[11px]">{KIND[r.kind]}</span>
      </span>
      <span className="flex items-start gap-1 font-medium">
        {r.title}
        {r.external && <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />}
      </span>
      <span className="text-fg-subtle">{r.evidence}</span>
      <span>{r.action}</span>
    </>
  );
  const className = "flex flex-col gap-1 px-4 py-3 text-[13px] hover:bg-hover";
  return r.external ? (
    <a href={r.href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={r.href} className={className}>
      {body}
    </Link>
  );
}
