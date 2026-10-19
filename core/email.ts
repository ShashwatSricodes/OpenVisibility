/**
 * Sends transactional email (magic links now; alerts later).
 *
 * With RESEND_API_KEY set, mail goes through Resend's HTTP API. Without it,
 * the message is printed to the terminal, so local development and
 * self-hosting work with no email account.
 */

import { env } from "./env";

export type Email = { to: string; subject: string; text: string; html?: string };

export async function sendEmail(email: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();

  if (!RESEND_API_KEY) {
    console.log(
      `\n── email (no RESEND_API_KEY, printing instead) ──\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`,
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
