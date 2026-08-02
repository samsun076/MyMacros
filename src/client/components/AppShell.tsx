import { Outlet } from "react-router";
import { TabBar } from "./TabBar";

/** The frame every signed-in screen renders into: the page wash, the phone
 *  column, safe-area padding, and the bottom chrome. */
export function AppShell() {
  return (
    <>
      <div className="frame shell">
        <Outlet />
      </div>
      <TabBar />
    </>
  );
}
