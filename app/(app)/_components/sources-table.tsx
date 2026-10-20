import { ExternalLink } from "lucide-react";
import type { DomainRow } from "@/core/citation-stats";
import { cn } from "../_lib/cn";

const LABEL: Record<DomainRow["kind"], { text: string; style: string }> = {
  owned: {
    text: "Yours",
    style: "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good",
  },
  competitor: {
    text: "Competitor",
    style: "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
  },
  third_party: { text: "Third party", style: "bg-pressed text-fg-subtle" },
};

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` === "/" ? "/" : `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
};

/** Domains cited, most first; each opens to its most-cited pages. */
export function SourcesTable({ domains, answers }: { domains: DomainRow[]; answers: number }) {
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 bg-hover px-4 py-2 text-xs text-fg-subtle">
        <span className="flex-1">Source</span>
        <span className="w-40 text-right sm:w-56">Cited in</span>
      </div>
      {domains.map((d) => {
        const label = LABEL[d.kind];
        const pct = answers ? Math.round((d.answers / answers) * 100) : 0;
        return (
          <details key={d.domain} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-hover">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate font-medium">{d.domain}</span>
                <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", label.style)}>
                  {d.competitor ?? label.text}
                </span>
              </span>
              <span className="flex w-40 items-center justify-end gap-2 sm:w-56">
                <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-pressed sm:block">
                  <span
                    className="block h-full rounded-full bg-fg"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </span>
                <span className="tabular w-24 shrink-0 text-right text-fg-subtle">
                  {d.answers.toLocaleString("en-US")} {d.answers === 1 ? "answer" : "answers"}
                </span>
              </span>
            </summary>
            <ul className="flex flex-col gap-1 px-4 pb-3">
              {d.pages.map((p) => (
                <li key={p.url} className="flex items-center gap-3 text-xs">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-1 text-fg-subtle hover:text-fg"
                  >
                    <span className="truncate">{p.title || pathOf(p.url)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                  <span className="tabular shrink-0 text-fg-muted">{p.answers}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
