/**
 * The OpenVisibility mark: a ring left open (the "O", and "open"), with a
 * beam of light streaking in through the gap (being seen). The beam tapers
 * from nothing to full strength, so the mark fades in from the left.
 *
 * Colours default to `currentColor`, so the mark follows the text colour.
 * Each instance needs a unique `id`: the beam's gradient is referenced by
 * id, and a duplicate inside a hidden element (mobile vs desktop nav)
 * stops it rendering in some browsers.
 */

/** The mark alone. Aspect ratio 5:4; the ring sits flush with the right edge. */
export function LogoMark({
  id,
  height = 24,
  className,
  title,
  ink = "currentColor",
}: {
  id: string;
  height?: number;
  className?: string;
  title?: string;
  ink?: string;
}) {
  const g = `ov-beam-${id}`;
  return (
    <svg
      viewBox="0 0 40 32"
      height={height}
      width={(height * 40) / 32}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={g} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={ink} stopOpacity="0" />
          <stop offset="0.55" stopColor={ink} stopOpacity="0.9" />
          <stop offset="1" stopColor={ink} />
        </linearGradient>
      </defs>
      <path
        d="M22.6 7.2A10 10 0 1 1 22.6 24.8"
        stroke={ink}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path d="M1 16 36.2 14.6V17.4Z" fill={`url(#${g})`} />
    </svg>
  );
}

/**
 * The logotype: the mark stands in for the "O", followed by "penVisibility".
 * Screen readers get the full name from the wrapper's aria-label.
 */
export function Logotype({
  id,
  height = 24,
  className,
  textClassName,
}: {
  id: string;
  height?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label="OpenVisibility"
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: height * 0.04 }}
    >
      <LogoMark id={id} height={height} />
      <span aria-hidden="true" className={textClassName}>
        penVisibility
      </span>
    </span>
  );
}
