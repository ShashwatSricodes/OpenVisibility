/**
 * Typed provider errors, so the worker can decide what to do without
 * reading messages: retry later, stop the run, or tell the user.
 */

export type ProviderErrorKind =
  /** the API key is missing, wrong or out of credit */
  | "auth"
  /** too many requests; back off before trying again */
  | "rate_limited"
  /** the job didn't finish in time; it may still finish, so check again later */
  | "timeout"
  /** the engine refused the scraper (a login wall, or "too many requests" upstream) */
  | "blocked"
  /** the request itself is wrong; retrying won't help */
  | "bad_input"
  /** no provider can answer for this engine yet */
  | "unavailable"
  /** anything else on the provider's side */
  | "upstream";

const RETRYABLE: Record<ProviderErrorKind, boolean> = {
  auth: false,
  rate_limited: true,
  timeout: true,
  blocked: true,
  bad_input: false,
  unavailable: false,
  upstream: true,
};

export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
    this.retryable = RETRYABLE[kind];
  }

  toItemError() {
    return { kind: this.kind, message: this.message, retryable: this.retryable };
  }
}

export const isRetryable = (kind: ProviderErrorKind) => RETRYABLE[kind];

/** Classify an HTTP error status from a provider's API. */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 402 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 404 || status === 422) return "bad_input";
  return "upstream";
}
