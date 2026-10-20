import { EXPORTS, type ExportKind } from "@/core/exports";
import { DEFAULT_RANGE, filterParams, type ViewFilter } from "@/core/filters";
import { SOURCE_NOTE } from "@/core/framing";
import { RANGES, type RangeId } from "@/core/overview";
import type { EngineId } from "@/core/providers/types";
import { ExportMenu, ViewFilters } from "./view-filters";

const RANGE_ITEMS = (Object.keys(RANGES) as RangeId[]).map((id) => ({
  id,
  label: RANGES[id].label,
}));

/** Links that download what's on screen: the CSVs listed, then the report. */
export function exportItems(params: URLSearchParams, kinds: ExportKind[], report = true) {
  const qs = params.size ? `?${params}` : "";
  return [
    ...kinds.map((k) => ({
      href: `/api/export/${k}.csv${qs}`,
      label: `${EXPORTS[k].label} (CSV)`,
      hint: EXPORTS[k].hint,
    })),
    ...(report
      ? [
          {
            href: `/report${qs}`,
            label: "Report (PDF)",
            hint: "Overview, competitors and citations, to print or save",
            newTab: true,
          },
        ]
      : []),
  ];
}

/** The date range, engine and country menus, plus Export, for a results page. */
export function PageFilters({
  filter,
  options,
  exports = [],
}: {
  filter: ViewFilter;
  options: { engines: { id: EngineId; name: string }[]; countries: string[] };
  exports?: ExportKind[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ViewFilters
        engines={options.engines}
        countries={options.countries}
        engine={filter.engine}
        country={filter.country}
        range={filter.range}
        ranges={RANGE_ITEMS}
        defaultRange={DEFAULT_RANGE}
      />
      {exports.length > 0 && (
        <ExportMenu items={exportItems(filterParams(filter), exports)} note={SOURCE_NOTE} />
      )}
    </div>
  );
}
