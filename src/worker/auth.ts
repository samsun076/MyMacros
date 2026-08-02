import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import { createDb } from "./db";

/** Auth for a Worker request (#6).
 *
 * better-auth is built per-request because its config depends on bindings and
 * secrets that only exist on `env`. It owns its own tables — plural model
 * names to match the rest of the schema; regenerate the DDL rather than
 * hand-editing it: `npm run auth:generate`.
 *
 * Google is optional on purpose: with no client id/secret in the environment
 * the provider simply isn't registered, so the app runs passkey-only.
 * Credentials land in Session B2 (see NEXT-STEPS.md).
 *
 * Sign-up path: Google creates the account, then the user adds a passkey from
 * Settings for one-tap sign-in afterwards. Passkey registration deliberately
 * requires a live session (better-auth's default) — the alternative, letting
 * an unauthenticated request mint a user, is open sign-up on a personal
 * deploy. Until Google creds land, `DEV_EMAIL_SIGN_IN` below fills the gap
 * locally.
 */
/** Vite replaces this with a literal; `false` lets the bundler drop the
 *  email/password endpoints entirely from the production Worker. */
const DEV_EMAIL_SIGN_IN = import.meta.env.DEV;

export function createAuth(env: Env) {
  const appUrl: string = env.APP_URL;
  const { hostname, origin } = new URL(appUrl);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

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
        rpID: hostname,
        rpName: "MyMacros",
        origin,
        schema: { passkey: { modelName: "passkeys" } },
        authenticatorSelection: {
          // Platform authenticator = Face ID / Touch ID on the phone that's
          // running the PWA, which is the whole point.
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "preferred",
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

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type Session = Auth["$Infer"]["Session"]["session"];
