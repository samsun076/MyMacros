import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

recordViewport();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

syncThemeColor();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** TEMPORARY — #51 instrumentation. Remove once the issue is characterised.
 *
 *  On a cold standalone launch the app paints a letterboxed column for the
 *  first seconds: reported as an empty splash column at roughly iOS's 980px
 *  no-viewport-meta default, then a narrower letterbox, then correct. That
 *  window closes before Web Inspector can attach, so the page has to record
 *  it itself and hold the result for reading afterwards.
 *
 *  Runs before React mounts, logs only when a measurement actually changes
 *  (so it's a change-log, not thousands of identical frames), and stops after
 *  8s. Read it from the inspector as `__vp`. */
function recordViewport() {
  const vv = window.visualViewport;
  const measure = () => ({
    t: Math.round(performance.now()),
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    visualWidth: vv ? Math.round(vv.width) : -1,
    scale: vv ? Number(vv.scale.toFixed(3)) : -1,
  });

  const key = (m: ReturnType<typeof measure>) =>
    `${m.innerWidth}/${m.clientWidth}/${m.scrollWidth}/${m.visualWidth}/${m.scale}`;
  const first = measure();
  const changes = [first];
  let last = key(first);

  const tick = () => {
    const m = measure();
    if (key(m) !== last) {
      changes.push(m);
      last = key(m);
    }
    if (m.t < 8000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  (window as unknown as { __vp: unknown }).__vp = {
    // the constants worth having next to the series when reading it back
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: window.devicePixelRatio,
    standalone: (navigator as unknown as { standalone?: boolean }).standalone ?? null,
    displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
    changes,
  };
}

/** Keep <meta name="theme-color"> equal to --bg-top for whichever theme is
 *  active. iOS Safari ignores it in-browser (it tints from the body
 *  background); whether standalone mode honours it is unverified — #39. The
 *  sync exists regardless because the theme is a per-user setting that can
 *  change at runtime (#29), so it can't be a static value in the HTML. */
function syncThemeColor() {
  const bgTop = getComputedStyle(document.documentElement).getPropertyValue("--bg-top").trim();
  if (!bgTop) return;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bgTop);
}
