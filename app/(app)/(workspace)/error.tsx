"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "../_components/page-frame";

/* A page that failed to load. The details go to the server log and the
   console, not the screen: what the user needs is a way back. */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-hover text-fg-subtle [&_svg]:size-5">
        <TriangleAlert />
      </span>
      <h1 className="text-base font-semibold">This page didn&rsquo;t load</h1>
      <p className="max-w-sm text-[13px] text-fg-subtle">
        Something went wrong on our side. Your data is safe; trying again usually works.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className={buttonPrimary}>
          <RotateCw className="size-3.5" />
          Try again
        </button>
        <Link href="/dashboard" className={buttonSecondary}>
          Go to Overview
        </Link>
      </div>
    </div>
  );
}
