/* 24px logo mark, white rounded square with the OpenVisibility glyph:
   an open ring (the "O") with a focal dot, read as a lens */
export function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#fff" />
      <path
        d="M17.4 8.6A6.2 6.2 0 1 0 18.2 12"
        stroke="#000"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.1" fill="#000" />
    </svg>
  );
}

/* 16px circle-check used in the pricing lists */
export function CircleCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.2 8.2 1.9 1.9 3.8-4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* 16px plus used by the FAQ rows */
export function Plus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
