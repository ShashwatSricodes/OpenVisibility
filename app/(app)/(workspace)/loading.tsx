/* Shown while a page's data loads: the shape of a page (title, a row of
   figures, a panel), so the layout doesn't jump when the content arrives. */

const Bar = ({ className }: { className: string }) => (
  <div className={`animate-pulse rounded-md bg-hover ${className}`} />
);

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4 p-4 sm:p-5 lg:px-6 lg:py-5"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col gap-2">
        <Bar className="h-5 w-32" />
        <Bar className="h-3 w-64 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <Bar className="h-3 w-20" />
            <Bar className="h-6 w-14" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <Bar className="h-3 w-40" />
        <Bar className="h-40 w-full sm:h-56" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
