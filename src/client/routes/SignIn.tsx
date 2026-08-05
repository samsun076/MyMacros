import { useEffect, useState } from "react";
import type { AuthMethods } from "../../shared/api";
import { api } from "../lib/api";
import { authClient, platformPasskeysAvailable } from "../lib/auth";

/** The only unauthenticated screen. Offers exactly the methods this
 *  deployment can honour — Google stays hidden until its credentials exist
 *  (Session B2) rather than showing a button that 500s. */
export function SignIn() {
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [hasPlatformAuth, setHasPlatformAuth] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuthMethods>("/api/auth-methods")
      .then(setMethods)
      .catch(() => setError("Couldn't reach the server."));
    void platformPasskeysAvailable().then(setHasPlatformAuth);
  }, []);

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
    <main className="signin">
      <div className="signin-head">
        <span className="eyebrow">
          <span className="tick" />
          MyMacros
        </span>
        <h1>
          Eat to the <span>budget</span> your running earns.
        </h1>
      </div>

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
          className={methods?.google ? "btn btn-quiet" : "btn btn-accent"}
          disabled={busy !== null}
          onClick={() => run("passkey", () => authClient.signIn.passkey())}
        >
          {busy === "passkey" ? "Waiting for your device…" : "Sign in with a passkey"}
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

      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}

      <p className="signin-note">
        {methods && !methods.google
          ? "Google sign-in isn't configured on this deployment yet."
          : "No passwords. Google once, then your face or fingerprint after that."}
        {!hasPlatformAuth && " This browser has no built-in passkey authenticator."}
      </p>
    </main>
  );
}
