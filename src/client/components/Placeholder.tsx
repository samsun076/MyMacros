/** A screen the shell can already route to, honest about what it isn't yet.
 *  Every one of these should disappear during M2–M5; if a placeholder is
 *  still here at the end of a milestone, something slipped. */
export function Placeholder({
  eyebrow,
  title,
  note,
  lands,
}: {
  eyebrow: string;
  title: string;
  note: string;
  lands: string;
}) {
  return (
    <>
      <header>
        <span className="eyebrow">
          <span className="tick" />
          {eyebrow}
        </span>
        <h1>{title}</h1>
      </header>
      <section className="placeholder">
        <p>{note}</p>
        <span className="mono">{lands}</span>
      </section>
    </>
  );
}
