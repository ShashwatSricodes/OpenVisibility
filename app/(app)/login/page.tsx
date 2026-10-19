import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/core/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  INVALID_TOKEN: "That sign-in link is invalid or has already been used. Request a new one.",
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one.",
  no_workspace: "Your account has no workspace. Contact the person who runs this install.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <LoginForm
        error={error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : undefined}
      />
    </main>
  );
}
