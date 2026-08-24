import { useEffect, useState } from "react";
import type { AuthMethods } from "../../shared/api";
import { api } from "../lib/api";
import { authClient, platformPasskeysAvailable } from "../lib/auth";

/** The only unauthenticated screen. Offers exactly the methods this
 *  deployment can honour — Google stays hidden until its credentials exist
 *  rather than showing a button that 500s.
 *
 *  It owns sign-UP as well as sign-in since #126. Enrolment used to live in
 *  Settings because it needed a live session, which meant an instance with no
 *  Google credentials had no way in at all. A passkey carries no email, so the
 *  form below collects one and hands it to the ceremony as `context`; the
 *  Worker decides whether that address may claim an account
 *  (`src/worker/signup.ts`).
 *
 *  Registration does not mint a session — better-auth's verify-registration
 *  only stores the credential — so enrolling is two calls, and the second is
 *  the ordinary passkey sign-in. */
export function SignIn() {
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [hasPlatformAuth, setHasPlatformAuth] = useState(false);
  // #enrol opens straight onto the sign-up form so a screenshot tool can reach
  // it — there is no cookie that puts a signed-out screen into a sub-state, and
  // the form is a text field, which is the shape #120 proved nothing here had
  // ever measured with a keyboard up. DEV is a build-time literal, so this is
  // compiled out of the production Worker along with the branch it opens.
  const [enrolling, setEnrolling] = useState(
    import.meta.env.DEV && window.location.hash === "#enrol",
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuthMethods>("/api/auth-methods")
      // `#fresh` fabricates the one thing a local database cannot be: empty.
      // Every dev machine has a dev user, so the screen a stranger actually
      // meets — nobody has claimed this yet — is otherwise unreachable by any
      // tool here. The flag is the input; the real branch renders over it,
      // which is /trends#empty's discipline.
      .then((m) =>
        setMethods(
          import.meta.env.DEV && window.location.hash === "#fresh"
            ? { ...m, claimed: false }
            : m,
        ),
      )
      .catch(() => setError("Couldn't reach the server."));
    void platformPasskeysAvailable().then(setHasPlatformAuth);
  }, []);

  // `methods` is null until the fetch lands, and "nobody has claimed this yet"
  // is a claim about the data — so it may only be made once the data arrived
  // (the rule #24 left behind). Before that, the screen renders as claimed,
  // which is the state every deployment but the very first is in.
  const unclaimed = methods !== null && !methods.claimed;

  // Exactly one accent button on this screen, ever. Google keeps it when it is
  // configured — it proves the address, which nothing else here does. Without
  // Google, an unclaimed deployment has precisely one workable action and it
  // is creating the first account, so that becomes the primary. A claimed one
  // is back to signing in.
  const signupPrimary = unclaimed && !methods?.google;

  async function run(kind: string, fn: () => Promise<{ error?: { message?: string } | null }>) {
    setBusy(kind);
    setError(null);
    try {
      const result = await fn();
      if (result.error) setError(result.error.message ?? "That didn't work.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={enrolling ? "signin signin-signup" : "signin"}>
      <div className="signin-head">
        <span className="eyebrow">
          <span className="tick" />
          MyMacros
        </span>
        <h1>
          Eat to the <span>budget</span> your running earns.
        </h1>
      </div>

      {enrolling ? (
        <form
          className="signin-actions signin-enrol"
          onSubmit={(e) => {
            e.preventDefault();
            void run("enrol", async () => {
              // Two calls, deliberately: registration stores the credential
              // and stops. The sign-in that follows is the same one the
              // returning-user button makes.
              const added = await authClient.passkey.addPasskey({ context: email.trim() });
              if (added?.error) return added;
              return authClient.signIn.passkey();
            });
          }}
        >
          <label className="field">
            <span className="eyebrow">Your email</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the field is
              // the only thing on this branch of the screen and the user got
              // here by asking for it
              autoFocus
            />
          </label>

          <button className="btn btn-accent" type="submit" disabled={busy !== null}>
            {busy === "enrol" ? "Waiting for your device…" : "Create my account"}
          </button>
          <button
            className="btn btn-text"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setEnrolling(false);
              setError(null);
            }}
          >
            Back
          </button>
        </form>
      ) : (
        <div className="signin-actions">
          {methods?.google && (
            <button
              className="btn btn-accent"
              disabled={busy !== null}
              onClick={() =>
                run("google", () =>
                  authClient.signIn.social({ provider: "google", callbackURL: "/" }),
                )
              }
            >
              {busy === "google" ? "Opening Google…" : "Continue with Google"}
            </button>
          )}

          <button
            className={methods?.google || signupPrimary ? "btn btn-quiet" : "btn btn-accent"}
            disabled={busy !== null}
            onClick={() => run("passkey", () => authClient.signIn.passkey())}
          >
            {busy === "passkey" ? "Waiting for your device…" : "Sign in with a passkey"}
          </button>

          {/* On a deployment nobody has claimed, this stops being a grey line
              under a big button that cannot work. #125's lesson, applied to
              the first screen a stranger sees. */}
          <button
            className={
              signupPrimary ? "btn btn-accent" : unclaimed ? "btn btn-quiet" : "btn btn-text"
            }
            disabled={busy !== null}
            onClick={() => {
              setEnrolling(true);
              setError(null);
            }}
          >
            {unclaimed ? "Create your account" : "First time here? Set up this device"}
          </button>

          {import.meta.env.DEV && methods?.devEmail && (
            <button
              className="btn btn-quiet btn-dev"
              disabled={busy !== null}
              onClick={() =>
                run("dev", async () => {
                  const creds = {
                    email: "dev@mymacros.local",
                    password: "dev-password-not-for-production",
                  };
                  const signedIn = await authClient.signIn.email(creds);
                  if (!signedIn.error) return signedIn;
                  return authClient.signUp.email({ ...creds, name: "Dev" });
                })
              }
            >
              {busy === "dev" ? "Signing in…" : "Dev sign-in (local only)"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}

      <p className="signin-note">
        {enrolling
          ? "Only addresses this deployment allows can create an account. Your device will ask for Face ID or your fingerprint."
          : unclaimed
            ? "Nobody has claimed this deployment yet. Create the first account with the email its ALLOWED_EMAILS names — no Google account needed."
            : methods && !methods.google
              ? "No passwords, and no Google account needed — your face or fingerprint is the whole sign-in."
              : "No passwords. Google or a passkey, then your face or fingerprint after that."}
        {!hasPlatformAuth && " This browser has no built-in passkey authenticator."}
      </p>
    </main>
  );
}
