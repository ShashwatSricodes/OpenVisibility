import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/core/auth/auth";

/* Better Auth's endpoints: sign-in, magic-link verify, session, sign-out.
   The auth instance is created on first request, so builds need no database. */
export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
