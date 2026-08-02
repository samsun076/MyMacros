import { useCallback, useEffect, useState } from "react";
import { authClient, platformPasskeysAvailable } from "../lib/auth";

type StoredPasskey = {
  id: string;
  name?: string | null | undefined;
  deviceType: string;
  createdAt?: Date | string | null | undefined;
};

/** Add / list / remove passkeys for the signed-in user. Registration needs a
 *  live session by design, so this lives inside the app rather than on the
 *  sign-in screen. Lands in Settings with #23. */
export function PasskeyManager() {
  const [keys, setKeys] = useState<StoredPasskey[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) setError(error.message ?? "Couldn't load passkeys.");
    else setKeys((data ?? []) as StoredPasskey[]);
  }, []);

  useEffect(() => {
    void refresh();
    void platformPasskeysAvailable().then(setSupported);
  }, [refresh]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: defaultPasskeyName(),
      });
      if (result?.error) setError(result.error.message ?? "Couldn't add that passkey.");
      else await refresh();
    } catch (e) {
      // The user dismissing the system sheet lands here — not worth an alarm.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        setError(e instanceof Error ? e.message : "Couldn't add that passkey.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) setError(error.message ?? "Couldn't remove that passkey.");
    else await refresh();
    setBusy(false);
  }

  return (
    <section className="passkeys">
      <div className="sec-head">
        <span className="eyebrow">Passkeys</span>
        <span className="mono">{keys ? `${keys.length} REGISTERED` : "…"}</span>
      </div>

      {keys?.length === 0 && (
        <p className="passkeys-empty">
          Add one and this phone signs you in with Face ID next time.
        </p>
      )}

      <ul className="passkey-list">
        {keys?.map((key) => (
          <li key={key.id}>
            <div>
              <span className="passkey-name">{key.name || "Passkey"}</span>
              <span className="mono passkey-meta">
                {key.deviceType === "singleDevice" ? "THIS DEVICE" : "SYNCED"}
                {key.createdAt ? ` · ${new Date(key.createdAt).toLocaleDateString()}` : ""}
              </span>
            </div>
            <button className="btn-text" disabled={busy} onClick={() => void remove(key.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <button className="btn btn-quiet" disabled={busy || !supported} onClick={() => void add()}>
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </button>

      {!supported && (
        <p className="passkeys-empty">This browser has no built-in passkey authenticator.</p>
      )}
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** A label the user will recognise in a list six months from now. */
function defaultPasskeyName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  return "This device";
}
