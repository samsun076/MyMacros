import { useEffect, useState } from "react";
import type { Health } from "../shared/api";

/** Scaffold boot check (#4) — the real shell lands with #8. */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main className="boot">
      <span className="eyebrow">MyMacros</span>
      <p>
        Worker {health?.ok ? "up" : "…"} · D1 {health?.db ? "connected" : "…"}
      </p>
    </main>
  );
}
