import { PasskeyManager } from "./components/PasskeyManager";
import { useSession } from "./lib/auth";
import { SignIn } from "./routes/SignIn";
import { authClient } from "./lib/auth";

/** Session gate. The signed-in branch becomes the tab-bar shell with #8. */
export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <main className="splash" aria-busy="true" />;
  }

  if (!session) {
    return <SignIn />;
  }

  return (
    <main className="frame">
      <header>
        <span className="eyebrow">
          <span className="tick" />
          Signed in
        </span>
        <h1>{session.user.name || session.user.email}</h1>
      </header>

      <PasskeyManager />

      <button className="btn btn-quiet" onClick={() => void authClient.signOut()}>
        Sign out
      </button>
    </main>
  );
}
