/** The PHOTO · BARCODE · TEXT row from sketches/e-log-flow.html.
 *
 *  Shared by both stages of the log flow because it is one control, not two:
 *  the camera stage carries it in its bottom deck (where the sketch puts it),
 *  the text stage under the top bar (where M2 put it — the sketch designs no
 *  text stage). Tapping a mode switches in place; nothing navigates. */

export type LogMode = "photo" | "barcode" | "text";

export function LogModes({
  mode,
  onMode,
  barcodeReady,
}: {
  mode: LogMode;
  onMode: (mode: LogMode) => void;
  /** BARCODE stays parked until #15 gives it a decoder. */
  barcodeReady: boolean;
}) {
  const modes: LogMode[] = ["photo", "barcode", "text"];
  return (
    <div className="modes" role="tablist" aria-label="Input mode">
      {modes.map((m) => {
        const parked = m === "barcode" && !barcodeReady;
        const selected = m === mode;
        const Tag = selected ? "b" : "span";
        return (
          <Tag
            key={m}
            role="tab"
            aria-selected={selected}
            aria-disabled={parked || undefined}
            tabIndex={parked ? -1 : 0}
            className={parked ? "parked" : undefined}
            onClick={parked ? undefined : () => onMode(m)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (!parked && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onMode(m);
              }
            }}
          >
            {m.toUpperCase()}
          </Tag>
        );
      })}
    </div>
  );
}
