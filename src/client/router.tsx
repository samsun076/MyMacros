import { createBrowserRouter } from "react-router";
import { AppShell } from "./components/AppShell";
import { Log } from "./routes/Log";
import { Settings } from "./routes/Settings";
import { Today } from "./routes/Today";
import { Trends } from "./routes/Trends";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Today /> },
      { path: "/trends", element: <Trends /> },
      { path: "/settings", element: <Settings /> },
      { path: "/log", element: <Log /> },
      // the Worker serves the shell for any path, so the client owns the 404
      { path: "*", element: <Today /> },
    ],
  },
]);
