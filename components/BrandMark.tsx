import { Logotype } from "./brand/Logo";

/* logotype for the landing page: the mark is the "O"; inherits the white text colour */
export function BrandMark({ id }: { id: string }) {
  return <Logotype id={id} height={24} />;
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
