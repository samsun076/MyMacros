import { useEffect, useState } from "react";

/** Add to Home Screen (#24).
 *
 *  **`beforeinstallprompt` is not a Safari API**, and this app's whole reason
 *  to be installed is iOS: standalone is where the launch images, the safe-area
 *  work and #38's chrome blend actually matter. So the iOS path is the primary
 *  one and it is *coaching*, not a button — Safari gives no programmatic way to
 *  install, and there is nothing to hook. Chrome and Edge do fire the event, so
 *  where it exists the card becomes a real button instead. Anywhere neither
 *  applies, this renders nothing rather than explaining a menu the browser
 *  doesn't have.
 *
 *  **Already installed → nothing at all.** `display-mode: standalone` covers
 *  every browser that implements the manifest; `navigator.standalone` is the
 *  iOS-only legacy flag and is still the one that answers on older iOS. Both,
 *  because getting this wrong shows an install prompt inside the installed app.
 *
 *  Dismissal is permanent and local. A prompt that returns is an advert.
 */

const DISMISSED = "mymacros.install-dismissed";

type Installable = { prompt: () => Promise<void> };

function isStandalone(): boolean {
  const legacy = (navigator as { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia("(display-mode: standalone)").matches;
}

/** iOS Safari, where installing is a menu item and not an API. Checks for the
 *  *absence* of the other engines rather than for "Safari", because every iOS
 *  browser is WebKit and every one of them installs the same way. */
function isIosWebKit(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<Installable | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the browser's own banner from appearing as well — one ask.
      e.preventDefault();
      setEvent(e as unknown as Installable);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;
  const ios = isIosWebKit();
  if (!ios && !event) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode; the card comes back next launch and that is survivable */
    }
  };

  return (
    <section className="install" aria-labelledby="install-title">
      <div className="sec-head">
        <span className="eyebrow" id="install-title">
          Add to home screen
        </span>
        <button type="button" className="btn-text" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      {ios ? (
        <p className="opt-hint">
          Tap <strong>Share</strong> in Safari's toolbar, then <strong>Add to Home Screen</strong>.
          It opens full-screen and works offline.
        </p>
      ) : (
        <>
          <p className="opt-hint">Opens full-screen and works offline.</p>
          <button
            className="btn btn-quiet"
            onClick={() => {
              void event?.prompt();
              dismiss();
            }}
          >
            Install
          </button>
        </>
      )}
    </section>
  );
}
