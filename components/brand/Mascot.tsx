/**
 * OpenVisibility's mascot and app icon.
 *
 * Adapted from the "Robot" emoji in Microsoft's Fluent UI Emoji
 * (https://github.com/microsoft/fluentui-emoji), MIT License,
 * Copyright (c) Microsoft Corporation. See NOTICE.
 * Changes: neutral palette, a single "lens" eye (ring and focal dot,
 * from the OpenVisibility mark), blue antenna tips, a smile.
 */

const ACCENT = "#3b82f6";

type Props = { size?: number; className?: string; title?: string };

/** Full-colour mascot, for the landing page, empty states and loading screens. */
export function Mascot({ size = 64, className, title }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M5 3.5C5 4.15311 4.5826 4.70873 4 4.91465V12L6.16075 17.4867L4 23C2.9 23 2 22.1008 2 21.0018V13.9982C2 13.2625 2.40334 12.6163 3 12.2695V4.91465C2.4174 4.70873 2 4.15311 2 3.5C2 2.67157 2.67157 2 3.5 2C4.32843 2 5 2.67157 5 3.5Z"
        fill="#525252"
      />
      <path
        d="M30.0499 3.55C30.0499 4.23107 29.6107 4.80955 29 5.01757V12.1998C29.5967 12.5469 30 13.1937 30 13.9301V20.9401C30 22.0401 29.1 22.9401 28 22.9401L25.0595 17.2609L28 11.9301L28 5.0176C27.3893 4.80961 26.95 4.23111 26.95 3.55C26.95 2.69396 27.6439 2 28.5 2C29.356 2 30.0499 2.69396 30.0499 3.55Z"
        fill="#525252"
      />
      <circle cx="3.5" cy="3.5" r="1.5" fill={ACCENT} />
      <circle cx="28.5" cy="3.55" r="1.55" fill={ACCENT} />
      <path
        d="M11 4.5C11 3.67157 11.6716 3 12.5 3H19.5C20.3284 3 21 3.67157 21 4.5C21 5.17932 20.5484 5.75317 19.9291 5.93774C19.6526 6.02012 19.3595 6.04161 19.0829 6.12355L16.0299 7.02792L12.9108 6.11964C12.6383 6.04028 12.3501 6.01951 12.0777 5.93974C11.4549 5.75736 11 5.1818 11 4.5Z"
        fill="#a3a3a3"
      />
      <path
        d="M22.05 30H9.95C6.66 30 4 27.34 4 24.05V12.03C4 8.7 6.7 6 10.03 6H21.98C25.3 6 28 8.7 28 12.03V24.06C28 27.34 25.34 30 22.05 30Z"
        fill="#d9d9de"
      />
      <path
        d="M9.24738 18.5H22.7526C25.0822 18.5 27 16.581 27 14.25C27 11.909 25.0922 10 22.7526 10H9.24738C6.9078 10 5 11.909 5 14.25C5 16.591 6.9078 18.5 9.24738 18.5Z"
        fill="#171717"
      />
      <circle cx="16" cy="14.25" r="3.1" stroke="#ffffff" strokeWidth="1.5" />
      <circle cx="16" cy="14.25" r="1.35" fill={ACCENT} />
      <circle cx="17.6" cy="12.7" r="0.55" fill="#ffffff" opacity="0.85" />
      <path
        d="M12.8 23.2Q16 26.2 19.2 23.2"
        stroke="#171717"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Simplified mascot on a tile, for small sizes (sidebar, nav, favicon).
 * Pass `tile` and `ink` (colours or CSS variables) to fit the background.
 */
export function AppIcon({
  size = 24,
  className,
  tile = "currentColor",
  ink = "#ffffff",
}: Props & { tile?: string; ink?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill={tile} />
      <path d="M16 5.2v3.6" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="5" r="1.7" fill={ACCENT} />
      <rect x="6" y="9" width="20" height="17" rx="5.5" fill={ink} />
      <rect x="8.2" y="12.2" width="15.6" height="7.6" rx="3.8" fill={tile} />
      <circle cx="16" cy="16" r="2.4" stroke={ink} strokeWidth="1.3" />
      <circle cx="16" cy="16" r="1" fill={ACCENT} />
    </svg>
  );
}
