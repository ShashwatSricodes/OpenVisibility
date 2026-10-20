"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Calendar, Check, ChevronDown, Download, ListFilter } from "lucide-react";
import { countryName } from "@/core/countries";
import type { EngineId } from "@/core/providers/types";
import { cn } from "../_lib/cn";

/* Filters kept in the URL, so a view can be shared; see core/filters.ts. */

const triggerClass =
  "flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[13px] text-fg outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-line-strong data-[state=open]:bg-hover";
const contentClass =
  "z-50 min-w-48 rounded-lg border border-line bg-panel p-1 text-[13px] text-fg shadow-[0_8px_24px_rgb(0_0_0/0.08)]";
const itemClass =
  "flex h-7 cursor-default items-center justify-between gap-6 rounded-md px-2 outline-none data-[highlighted]:bg-hover";

function useParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // a filter change starts the list over
    next.delete("page");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
}

export function ViewFilters({
  engines,
  countries,
  engine,
  country,
  range,
  ranges,
  defaultRange,
}: {
  engines: { id: EngineId; name: string }[];
  countries: string[];
  engine?: EngineId;
  country?: string;
  range: string;
  ranges: { id: string; label: string }[];
  /** the range left out of the URL */
  defaultRange: string;
}) {
  const set = useParam();
  const active = (engine ? 1 : 0) + (country ? 1 : 0);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger className={triggerClass}>
          <ListFilter className="size-3.5" />
          Filter
          {active > 0 && (
            <span className="tabular rounded bg-fg px-1.5 text-[11px] font-medium text-panel">
              {active}
            </span>
          )}
          <ChevronDown className="size-4 text-fg-muted" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className={contentClass}>
            <Menu.Label className="px-2 pb-1 pt-1.5 text-xs text-fg-muted">Engine</Menu.Label>
            {[{ id: "", name: "All engines" }, ...engines].map((e) => (
              <Menu.Item
                key={e.id || "all"}
                onSelect={() => set("engine", e.id || null)}
                className={itemClass}
              >
                {e.name}
                {(engine ?? "") === e.id && <Check className="size-4" strokeWidth={2.25} />}
              </Menu.Item>
            ))}
            {(countries.length > 1 || country) && (
              <>
                <Menu.Separator className="my-1 h-px bg-line" />
                <Menu.Label className="px-2 pb-1 pt-1.5 text-xs text-fg-muted">Country</Menu.Label>
                {["", ...countries].map((c) => (
                  <Menu.Item
                    key={c || "all"}
                    onSelect={() => set("country", c || null)}
                    className={itemClass}
                  >
                    {c ? countryName(c) : "All countries"}
                    {(country ?? "") === c && <Check className="size-4" strokeWidth={2.25} />}
                  </Menu.Item>
                ))}
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Menu.Root>
        <Menu.Trigger className={cn(triggerClass, "justify-between sm:min-w-36")}>
          <span className="flex items-center gap-2">
            <Calendar className="size-3.5" />
            {ranges.find((r) => r.id === range)?.label}
          </span>
          <ChevronDown className="size-4 text-fg-muted" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className={contentClass}>
            {ranges.map((r) => (
              <Menu.Item
                key={r.id}
                onSelect={() => set("range", r.id === defaultRange ? null : r.id)}
                className={itemClass}
              >
                {r.label}
                {range === r.id && <Check className="size-4" strokeWidth={2.25} />}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}

/** Downloads of what's on screen: CSV files, and the report to save as a PDF. */
export function ExportMenu({
  items,
  note,
}: {
  items: { href: string; label: string; hint: string; newTab?: boolean }[];
  /** how the answers were collected; shown under the downloads */
  note: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClass} aria-label="Export">
        <Download className="size-3.5" />
        <span className="hidden sm:inline">Export</span>
        <ChevronDown className="size-4 text-fg-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={cn(contentClass, "w-64")}>
          {items.map((i) => (
            <Menu.Item key={i.href} asChild>
              <a
                href={i.href}
                {...(i.newTab ? { target: "_blank", rel: "noreferrer" } : { download: "" })}
                className="flex cursor-default flex-col rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
              >
                <span>{i.label}</span>
                <span className="text-xs text-fg-subtle">{i.hint}</span>
              </a>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-line" />
          <p className="px-2 pb-1.5 pt-0.5 text-xs leading-snug text-fg-subtle">{note}</p>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
