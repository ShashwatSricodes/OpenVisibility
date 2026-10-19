/**
 * Countries a workspace can track in. Bright Data runs each prompt from an
 * IP in the chosen country; this list keeps to markets with enough AI
 * usage to be worth tracking. Add a country by adding a line.
 */

export const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "IE", name: "Ireland" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "ZA", name: "South Africa" },
  { code: "NZ", name: "New Zealand" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

const NAMES = new Map<string, string>(COUNTRIES.map((c) => [c.code, c.name]));

export const isCountryCode = (v: string): v is CountryCode => NAMES.has(v);

export const countryName = (code: string) => NAMES.get(code) ?? code;
