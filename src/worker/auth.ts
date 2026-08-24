import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { D1Dialect } from "kysely-d1";
import { createDb } from "./db";
import { decideSignup, emailAllowed, normalizeEmail, SIGNUP_REFUSAL_MESSAGE } from "./signup";

/** Auth for a Worker request (#6).
 *
 * better-auth is built per-request because its config depends on bindings and
 * secrets that only exist on `env`. It owns its own tables — plural model
 * names to match the rest of the schema; regenerate the DDL rather than
 * hand-editing it: `npm run auth:generate`.
 *
 * Google is optional on purpose: with no client id/secret in the environment
 * the provider simply isn't registered, so the app runs passkey-only.
 *
 * Sign-up path: a passkey, on its own, with no session and no Google (#126).
 * `registration.requireSession` is off and `resolveUser` below decides who the
 * ceremony is for; `src/worker/signup.ts` holds the rule and the reasoning.
 *
 * **This deliberately replaces the opposite instruction, which stood here for
 * 21 days after its reason expired.** Registration required a session because
 * "letting an unauthenticated request mint a user is open sign-up on a
 * personal deploy" — true on 2026-08-02, and closed the next day by
 * `ALLOWED_EMAILS`, which refuses a stranger on every path in. The comment
 * went on asserting the dead danger because comments are not executed. The
 * cost was that a fresh instance with no Google credentials could not be
 * signed into at all, which made the whole self-host story unreachable.
 */
/** Vite replaces this with a literal; `false` lets the bundler drop the
 *  email/password endpoints entirely from the production Worker. */
const DEV_EMAIL_SIGN_IN = import.meta.env.DEV;

export function createAuth(env: Env) {
  const appUrl: string = env.APP_URL;
  const { hostname, origin } = new URL(appUrl);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const rpID = passkeyRpId(env, hostname);

  return betterAuth({
    appName: "MyMacros",
    baseURL: appUrl,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],

    database: { dialect: new D1Dialect({ database: env.DB }), type: "sqlite" },

    // No passwords in the shipped app, ever (PLAN.md) — Google + passkeys only.
    // This exists so the app is usable and testable before Google credentials
    // land; see tools/verify-auth.mjs.
    //
    // Vite replaces DEV_EMAIL_SIGN_IN with a literal at build time, so a
    // production Worker is built with `enabled: false` and there is no
    // environment variable that can turn it back on. better-auth still routes
    // /sign-up/email and /sign-in/email either way — what changes is that they
    // refuse: verified against the built Worker, sign-up answers
    // EMAIL_PASSWORD_SIGN_UP_DISABLED while the passkey endpoints stay live.
    emailAndPassword: { enabled: DEV_EMAIL_SIGN_IN, requireEmailVerification: false },

    socialProviders: googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},

    plugins: [
      passkey({
        rpID,
        rpName: "MyMacros",
        origin,
        schema: { passkey: { modelName: "passkeys" } },
        authenticatorSelection: {
          // Platform authenticator = Face ID / Touch ID / Android biometrics on
          // the device running the PWA. Deliberate, and not a limitation to
          // "fix": capture is mobile (PLAN.md), so a passkey belongs on the
          // phone you log meals with, never on a desktop you review from.
          //
          // This constrains REGISTRATION only. Signing in still offers the
          // cross-device QR flow, which is exactly how the desktop review
          // session is meant to work — scan with the phone, no credential
          // ever stored on the desktop.
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "preferred",
        },

        // Sign-up with nothing but a face (#126). A passkey carries no email,
        // so the sign-in screen sends one as `context` on
        // GET /passkey/generate-register-options and `resolveUser` turns it
        // into a user id. better-auth does NOT create the user for you.
        //
        // Two traps, both paid for in the spike:
        //
        //  1. This runs ONLY when there is no session. With one, the plugin
        //     resolves the session user itself and never calls in here — so
        //     Settings' "add a passkey" is untouched by any of this, and the
        //     claim rule below cannot lock out a signed-in person adding a
        //     second device.
        //  2. Create through `internalAdapter`, never a raw D1 insert. The
        //     adapter fires `databaseHooks`, which is what applies
        //     ALLOWED_EMAILS and what writes the profile row. A raw insert
        //     silently bypasses both, and the symptom is open sign-up.
        registration: {
          requireSession: false,
          resolveUser: async ({ ctx, context }) => {
            const email = normalizeEmail(context);
            const found = email
              ? await ctx.context.internalAdapter.findUserByEmail(email, { includeAccounts: true })
              : null;
            const passkeys = found
              ? await ctx.context.adapter.findMany({
                  model: "passkey",
                  where: [{ field: "userId", value: found.user.id }],
                })
              : [];

            const decision = decideSignup({
              context,
              allowList: env.ALLOWED_EMAILS,
              existing: found
                ? { id: found.user.id, credentials: found.accounts.length + passkeys.length }
                : null,
            });

            if (decision.action === "refuse") {
              throw new APIError(decision.refusal === "not_allowed" ? "FORBIDDEN" : "BAD_REQUEST", {
                message: SIGNUP_REFUSAL_MESSAGE[decision.refusal],
              });
            }

            // `emailVerified` stays false and that is honest: nothing on this
            // deployment sends mail, so nobody has proved they own the
            // address. What proves identity here is the passkey, and the
            // allowlist is what decides the address may exist at all.
            const id =
              decision.action === "attach"
                ? decision.userId
                : (
                    await ctx.context.internalAdapter.createUser({
                      email: decision.email,
                      name: decision.email,
                      emailVerified: false,
                    })
                  ).id;

            return { id, name: decision.email, displayName: decision.email };
          },
        },
      }),
    ],

    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 30, // 30 days — this is a daily-use app
      updateAge: 60 * 60 * 24, // slide the window at most once a day
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    user: { modelName: "users" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },

    databaseHooks: {
      user: {
        create: {
          // Who is allowed to exist here (#33). Without this, anyone who
          // reaches the URL and clicks Continue with Google gets an account —
          // and from M2, spends this deployment's ANTHROPIC_API_KEY.
          //
          // Creation only: an address removed from the list later keeps its
          // existing account and sessions. Revoking access is a different job
          // (delete the user; the cascade takes their data with it).
          before: async (user) => {
            if (!emailAllowed(env.ALLOWED_EMAILS, user.email)) {
              throw new APIError("FORBIDDEN", {
                // On the Google path better-auth turns this into the `error`
                // query param on its error page, joining spaces with
                // underscores — so keep it a short sentence that survives that.
                message: SIGNUP_REFUSAL_MESSAGE.not_allowed,
              });
            }
          },

          // Every user has a profile from the moment they exist, so no route
          // ever has to cope with a half-created account.
          after: async (user) => {
            await createDb(env)
              .insertInto("profiles")
              .values({ user_id: user.id })
              .onConflict((oc) => oc.column("user_id").doNothing())
              .execute();
          },
        },
      },
    },

    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
  });
}

/** Which domain passkeys are bound to.
 *
 *  Defaults to the app's own hostname — the tightest possible scope, and what
 *  a self-hoster gets with no configuration. Setting `PASSKEY_RP_ID` to a
 *  parent domain widens it deliberately: `debrief.run` on this deployment, so
 *  one passkey can sign into every `*.debrief.run` app as they appear.
 *
 *  **This is effectively irreversible.** Credentials are bound to the rpID
 *  they were created under, so narrowing or widening it later forces everyone
 *  to re-enrol. Decided in #34.
 *
 *  WebAuthn only permits an rpID that the origin's hostname equals or is a
 *  subdomain of; anything else fails in the browser with a message about
 *  registrable domain suffixes, long after the misconfiguration. Fail here
 *  instead, where the reason is obvious.
 */
function passkeyRpId(env: Env, hostname: string): string {
  const configured = env.PASSKEY_RP_ID?.trim();
  if (!configured) return hostname;
  if (hostname !== configured && !hostname.endsWith(`.${configured}`)) {
    throw new Error(
      `PASSKEY_RP_ID "${configured}" is not valid for host "${hostname}" — ` +
        `it must be that host or a parent domain of it.`,
    );
  }
  return configured;
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type Session = Auth["$Infer"]["Session"]["session"];
