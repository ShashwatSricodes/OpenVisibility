import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonSecondary } from "../_components/page-frame";

/* An answer, prompt or run that doesn't exist, or belongs to another workspace. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-hover text-fg-subtle [&_svg]:size-5">
        <SearchX />
      </span>
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="max-w-sm text-[13px] text-fg-subtle">
        It may have been deleted, or the link is wrong.
      </p>
      <Link href="/dashboard" className={buttonSecondary}>
        Go to Overview
      </Link>
    </div>
  );
}
