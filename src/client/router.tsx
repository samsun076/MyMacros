import { createBrowserRouter } from "react-router";
import { AppShell } from "./components/AppShell";
import { Log } from "./routes/Log";
import { Onboarding } from "./routes/Onboarding";
import { Settings } from "./routes/Settings";
import { Weight } from "./routes/Weight";
import { Today } from "./routes/Today";
import { Trends } from "./routes/Trends";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Today /> },
      { path: "/trends", element: <Trends /> },
      { path: "/settings", element: <Settings /> },
      // the Worker serves the shell for any path, so the client owns the 404
      { path: "*", element: <Today /> },
    ],
  },
  // The log flow is modal — no tab bar, its own close affordance (the
  // sketch's camera/confirm stages carry no bottom chrome).
  { path: "/log", element: <Log /> },
  // Onboarding and the weigh-in are modal for the same reason: both are a
  // task you finish and leave, not a place you browse to (#17, #18).
  { path: "/onboarding", element: <Onboarding /> },
  { path: "/weight", element: <Weight /> },
]);
