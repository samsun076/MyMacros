import { useEffect } from "react";
import { RouterProvider } from "react-router";
import type { Me } from "../shared/api";
import { useApi } from "./lib/api";
import { useSession } from "./lib/auth";
import { applyTheme } from "./lib/theme";
import { router } from "./router";
import { SignIn } from "./routes/SignIn";

/** Session gate: one unauthenticated screen, or the whole shell. */
export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <main className="splash" aria-busy="true" />;
  }

  return session ? (
    <>
      <ThemeFromProfile />
      <RouterProvider router={router} />
    </>
  ) : (
    <SignIn />
  );
}

/** The profile decides the theme, and this is the only thing that says so
 *  (#29).
 *
 *  Here rather than in `AppShell` because the log flow, onboarding and the
 *  weigh-in are routed outside it — a theme that stopped applying the moment
 *  you opened the camera would be a per-screen setting, not a per-user one.
 *
 *  It costs one `/api/me` on app load. That is the price of the alternative
 *  being five screens each remembering to apply the theme after their own
 *  fetch, which is five places for a new screen to forget. What it corrects is
 *  the mirror the boot script painted from: same value in the ordinary case,
 *  and the profile's when they disagree — a theme changed on another device,
 *  or a `localStorage` a private window never wrote.
 */
function ThemeFromProfile() {
  const { data: me } = useApi<Me>("/api/me");
  const theme = me?.profile.theme;
  const accent = me?.profile.accent;

  useEffect(() => {
    if (theme && accent) applyTheme(theme, accent);
  }, [theme, accent]);

  return null;
}
