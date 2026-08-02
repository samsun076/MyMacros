import { RouterProvider } from "react-router";
import { useSession } from "./lib/auth";
import { router } from "./router";
import { SignIn } from "./routes/SignIn";

/** Session gate: one unauthenticated screen, or the whole shell. */
export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <main className="splash" aria-busy="true" />;
  }

  return session ? <RouterProvider router={router} /> : <SignIn />;
}
