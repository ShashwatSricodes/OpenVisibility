"use client";

import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Logotype } from "@/components/brand/Logo";
import { authClient } from "@/core/auth/client";

export function LoginForm({ error }: { error?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState(error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setProblem(undefined);
    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: "/dashboard",
      errorCallbackURL: "/login",
    });
    if (error) {
      setProblem(error.message ?? "Couldn't send the link. Please try again.");
      setState("idle");
    } else {
      setState("sent");
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center">
        <Logotype
          id="login"
          height={20}
          textClassName="font-display text-[17px] font-semibold tracking-tight"
        />
      </div>

      <div className="rounded-xl border border-line bg-panel p-6">
        {state === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-pressed">
              <Mail className="size-4 text-fg-default" />
            </span>
            <h1 className="text-base font-semibold">Check your email</h1>
            <p className="text-[13px] text-fg-subtle">
              We sent a sign-in link to <span className="text-fg">{email.trim()}</span>. It expires
              in 15 minutes.
            </p>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-fg-subtle transition-colors hover:text-fg"
            >
              <ArrowLeft className="size-3.5" />
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h1 className="text-base font-semibold">Sign in to OpenVisibility</h1>
              <p className="mt-1 text-[13px] text-fg-subtle">
                We&rsquo;ll email you a link. No password needed.
              </p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-default">Email</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-9 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-line-strong focus:ring-2 focus:ring-line"
              />
            </label>

            {problem && (
              <p role="alert" className="text-[13px] text-bad">
                {problem}
              </p>
            )}

            <button
              type="submit"
              disabled={state === "sending"}
              className="flex h-9 items-center justify-center rounded-lg bg-inverted text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {state === "sending" ? "Sending link…" : "Continue with email"}
            </button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-fg-muted">
        New here? Signing in creates your account and workspace.
      </p>
    </div>
  );
}
