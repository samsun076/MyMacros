/** Who a *sessionless* passkey registration is for, and whether it may proceed
 *  at all (#126).
 *
 *  Registration used to require a live session, which meant a fresh instance
 *  with no Google credentials could not be signed into at all: no session, no
 *  passkey enrolment, no session. `ALLOWED_EMAILS` (#33) closed the threat the
 *  session requirement existed to stop, one day after it was written, and
 *  nobody re-asked for 21 days. This module is the re-ask.
 *
 *  **A passkey carries no email**, so the browser sends one as the plugin's
 *  `context` query param and this decides what to do with it. That is the
 *  whole attack surface, and an email address is not a secret — so the rule
 *  the decision enforces is deliberately narrow:
 *
 *    **The sessionless route may only CLAIM an unclaimed address.**
 *
 *  Knowing an allowlisted email gets you an account that does not exist yet
 *  and nothing else. Attaching a device to an account that already has any way
 *  in requires a session, which means Settings, which means already being that
 *  person. Note that better-auth never calls `resolveUser` when a session is
 *  present (`resolveRegistrationUser` in the plugin), so Settings' "add a
 *  passkey" does not pass through here and is unaffected.
 *
 *  The one case that is neither hijack nor fresh claim is an **abandoned
 *  ceremony**: `generate-register-options` creates the user row *before* the
 *  browser prompts, so tapping Cancel on Face ID leaves an account with no
 *  credential at all. Refusing that would brick a fresh instance on a
 *  mistap — the worst possible failure for the one thing that has to work
 *  before anything else does. So an account with zero credentials is treated
 *  as still unclaimed and healed rather than refused.
 */

/** Why a sessionless registration was refused. The caller renders the message,
 *  and the *reason* is what a check must assert — the spike in #126 had two
 *  decorative assertions that passed on the wrong mechanism producing the same
 *  outcome, which is the failure mode this type exists to make impossible. */
export type SignupRefusal = "no_email" | "not_allowed" | "already_claimed";

export type SignupDecision =
  | { action: "create"; email: string }
  | { action: "attach"; email: string; userId: string }
  | { action: "refuse"; refusal: SignupRefusal };

/** What the user is told, per refusal.
 *
 *  `not_allowed` is worded for the worst renderer it has: on the Google path
 *  better-auth puts this string in an `error` query param and joins spaces
 *  with underscores, so it stays a short sentence with no punctuation to
 *  mangle. The allowlist hook in `auth.ts` throws this same constant — one
 *  refusal, one wording, per #86. */
export const SIGNUP_REFUSAL_MESSAGE: Record<SignupRefusal, string> = {
  no_email: "Enter the email address this deployment allows.",
  not_allowed: "This email is not allowed on this deployment",
  already_claimed:
    "That account already has a way in. Sign in with it, then add this device from Settings.",
};

/** Lowercased and trimmed, or null if it could not be an address at all.
 *
 *  Deliberately not a validator. `ALLOWED_EMAILS` is the gate that matters and
 *  it compares exact strings; all this has to do is tell "nothing was typed"
 *  apart from "an address was typed", so that an empty field gets the useful
 *  message instead of the accusatory one. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? "";
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return null;
  if (at === email.length - 1 || /\s/.test(email)) return null;
  return email;
}

/** Whether `email` may create an account on this deployment (#33).
 *
 *  `ALLOWED_EMAILS` is a comma-separated list, matched case-insensitively —
 *  the minimum slice of the sign-up problem: no new infrastructure, and it
 *  works from the first deploy. The claim flow #33 describes (first person
 *  through becomes the owner) replaces this later.
 *
 *  **Empty or unset refuses everyone.** A guard that defaults to "allow" is
 *  the hole it was written to close: a deploy that forgets the var would look
 *  fine and be open. This way it's shut, loudly, and the fix is one secret.
 *  That default is also what makes #126 safe to ship with no other lock — a
 *  self-hoster who has not set the list cannot be signed up over. */
export function emailAllowed(allowList: string | null | undefined, email: string | null | undefined): boolean {
  const allowed = (allowList ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const candidate = email?.trim().toLowerCase();
  return Boolean(candidate) && allowed.includes(candidate!);
}

/** The decision, as a pure function, so it has an oracle.
 *
 *  `credentials` is every way into that account that already exists — passkey
 *  rows plus linked accounts (Google, and the dev-only credential provider).
 *  Counting both matters: a Google-created account has no passkeys, and
 *  treating "no passkeys" as unclaimed would hand it to anyone who knows the
 *  address.
 *
 *  **The order of the checks is load-bearing.** The allowlist is consulted
 *  before existence, so a prober who is not on the list gets the same answer
 *  whether or not the account exists, and cannot enumerate users. */
export function decideSignup(input: {
  context: string | null | undefined;
  allowList: string | null | undefined;
  existing: { id: string; credentials: number } | null;
}): SignupDecision {
  const email = normalizeEmail(input.context);
  if (!email) return { action: "refuse", refusal: "no_email" };
  if (!emailAllowed(input.allowList, email)) return { action: "refuse", refusal: "not_allowed" };
  if (!input.existing) return { action: "create", email };
  if (input.existing.credentials > 0) return { action: "refuse", refusal: "already_claimed" };
  return { action: "attach", email, userId: input.existing.id };
}
