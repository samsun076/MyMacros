import { Outlet } from "react-router";
import { useOnline } from "../lib/sw";
import { TabBar } from "./TabBar";

/** The frame every signed-in screen renders into: the page wash, the phone
 *  column, safe-area padding, and the bottom chrome. */
export function AppShell() {
  const online = useOnline();

  return (
    <>
      <div className="frame shell">
        {/* The shell is precached (#54), so the app now opens with no
            connection — which is a new way to be confusing rather than a new
            feature on its own. Without this the screens render their own
            "couldn't load" copy and every one of them reads like the server is
            broken. Saying it once, at the top, is the whole of the decision
            not to queue offline writes: be clear that it can't, rather than
            imply it did. */}
        {!online && (
          <p className="offline" role="status">
            Offline — showing what's cached. You can't log or sync until you're back.
          </p>
        )}
        <Outlet />
      </div>
      <TabBar />
    </>
  );
}
