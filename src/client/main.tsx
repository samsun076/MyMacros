import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

syncThemeColor();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

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
