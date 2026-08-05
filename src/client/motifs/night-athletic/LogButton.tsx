/** Night Athletic log button (motif slot 3): 58px rounded-square accent
 *  button lifted above the tab bar — the first motif moved into the registry
 *  (was inline in TabBar.tsx). Light themes restyle shape/shadow per their
 *  material in the M5 port (#30). */
export function LogButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="log-btn" aria-label="Log food" onClick={onClick}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round">
        <path d="M12 4v16M4 12h16" />
      </svg>
    </button>
  );
}
