"use client";

import { Printer } from "lucide-react";

/** Opens the print dialog, where "Save as PDF" makes the file. Not printed itself. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted print:hidden"
    >
      <Printer className="size-3.5" />
      Save as PDF
    </button>
  );
}
