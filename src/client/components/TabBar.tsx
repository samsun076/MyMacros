import { NavLink, useNavigate } from "react-router";

/** Bottom chrome. Two conventions are load-bearing here and are documented in
 *  design/TOKENS.md — change them only with a device test:
 *
 *  1. The bar is fully opaque `--chrome` with no backdrop-filter and nothing
 *     drawn below it. iOS Safari tints its own chrome from this surface, and
 *     it won't sample a translucent one.
 *  2. `--chrome` is never accent-tinted, because the accent switches live.
 *
 *  Layout is the sketch's: Today on the left, the log button straddling the
 *  top edge, Trends and Settings on the right. */
export function TabBar() {
  const navigate = useNavigate();

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabzone solo">
        <Tab to="/" label="Today">
          <circle cx="11" cy="11" r="8" />
          <circle cx="11" cy="11" r="2.4" fill="currentColor" stroke="none" />
        </Tab>
      </div>

      <button className="log-btn" aria-label="Log food" onClick={() => void navigate("/log")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 4v16M4 12h16" />
        </svg>
      </button>

      <div className="tabzone">
        <Tab to="/trends" label="Trends">
          <path d="M3 17l5-6 4 3.5L19 6" strokeLinejoin="round" />
          <path d="M15 6h4v4" strokeLinejoin="round" />
        </Tab>
        <Tab to="/settings" label="Settings">
          <path d="M4 7h14M4 15h14" />
          {/* knobs sit on the bar, so they punch through in --chrome */}
          <circle cx="14" cy="7" r="2.4" fill="var(--chrome)" />
          <circle cx="8" cy="15" r="2.4" fill="var(--chrome)" />
        </Tab>
      </div>
    </nav>
  );
}

function Tab({ to, label, children }: { to: string; label: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} end className={({ isActive }) => (isActive ? "tab on" : "tab")}>
      <svg width="21" height="21" viewBox="0 0 22 22" fill="none" strokeWidth="1.7" strokeLinecap="round">
        {children}
      </svg>
      {label}
    </NavLink>
  );
}
