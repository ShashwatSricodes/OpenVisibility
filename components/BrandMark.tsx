import { AppIcon } from "./brand/Mascot";

/* 24px logo mark for the dark landing page: the mascot app icon on a white tile */
export function BrandMark() {
  return <AppIcon size={24} tile="#ffffff" ink="#0a0a0a" />;
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
