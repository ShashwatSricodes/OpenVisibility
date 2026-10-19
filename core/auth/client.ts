"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side auth: request a magic link, read the session, sign out. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
