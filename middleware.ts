import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast first gate for product pages: no session cookie, straight to /login.
 * It only checks the cookie exists; (workspace)/layout.tsx validates the
 * session itself on the server.
 */
export function middleware(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/prompts/:path*",
    "/answers/:path*",
    "/citations/:path*",
    "/competitors/:path*",
    "/runs/:path*",
    "/settings/:path*",
    "/billing/:path*",
    "/help/:path*",
    "/onboarding/:path*",
    "/report/:path*",
    "/audit/:path*",
    "/recommendations/:path*",
    "/outreach/:path*",
    "/traffic/:path*",
  ],
};
