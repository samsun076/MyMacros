import { useEffect, useState } from "react";

/** The app's side of the service worker (#54) — registration, the update
 *  affordance, and whether we are online.
 *
 *  The worker itself is `src/client/sw.js`, emitted with this build's precache
 *  manifest by a plugin in vite.config.ts. */

/** Registered only in a production build.
 *
 *  `import.meta.env.PROD` is a build-time literal, so the registration call is
 *  compiled out of dev entirely rather than guarded at runtime. That matters
 *  more than it looks: a worker serving a cached shell in front of Vite's dev
 *  server would intercept HMR and hand back a stale document, and the symptom
 *  — "my edit didn't take" — is one people chase for an hour before suspecting
 *  a service worker. Same reasoning as the DEV-only sign-in button. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  // After load, so the first launch spends its bandwidth on the app rather
  // than on precaching the app it is already fetching.
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

export type UpdateState = "current" | "checking" | "available" | "updating";

/** Drives Settings' "check for update" row.
 *
 *  The default flow is deliberately passive — a new worker installs and waits
 *  until the app is closed, so an update can never reload the page mid-meal.
 *  The cost of that patience is not knowing whether you are on the newest
 *  build, and "is it updated yet?" is not a question a person should have to
 *  answer by guessing. This is the escape hatch: ask now, and apply now. */
export function useUpdate() {
  const [state, setState] = useState<UpdateState>("current");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) setState("available");
    });
  }, []);

  async function check() {
    if (!("serviceWorker" in navigator)) return;
    setState("checking");
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return setState("current");

    // update() resolves once the check is done; a newly-found worker may still
    // be installing, so `waiting` is what actually answers the question.
    await reg.update().catch(() => undefined);
    if (reg.installing) {
      await new Promise<void>((resolve) => {
        const w = reg.installing;
        if (!w) return resolve();
        w.addEventListener("statechange", () => {
          if (w.state === "installed" || w.state === "redundant") resolve();
        });
      });
    }
    setState(reg.waiting ? "available" : "current");
  }

  async function apply() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.waiting) return;
    setState("updating");
    // The page reloads when the new worker takes control. `once` because
    // controllerchange also fires on the very first registration, and a
    // reload loop is the classic way to get this wrong.
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return { state, check, apply };
}

/** Whether the browser thinks it has a connection.
 *
 *  `navigator.onLine` only ever proves a *negative* — false means definitely
 *  offline, true means "there is an interface up", which a hotel wifi portal
 *  also satisfies. That asymmetry is why this drives a banner and nothing
 *  else: a real request failing is still what tells a screen something went
 *  wrong, and `ApiError(0, "network")` is unchanged. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
