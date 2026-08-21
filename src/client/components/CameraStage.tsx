import { useEffect, useRef, useState } from "react";
import { scanner } from "../lib/barcode";
import { acquireCamera, openCamera } from "../lib/camera";
import { frameFromFile, frameFromVideo } from "../lib/photo";
import { LogModes, type LogMode } from "./LogModes";
import { StarGlyph } from "./StarGlyph";

/** The camera stage, ported from sketches/e-log-flow.html#camera — brackets,
 *  shutter, mode deck — built around a real <video> (#13).
 *
 *  Mechanism settled on #13 and verified on the device rather than from
 *  documentation: a getUserMedia viewfinder, with `<input capture>` as the
 *  fallback for when the API is absent or the permission is refused. The
 *  sketch's own markup is commented "straight to the viewfinder", so handing
 *  the screen to iOS's camera app would mean never showing a designed screen.
 *
 *  The stage *shows* the camera; the session behind it belongs to
 *  `lib/camera.ts` and the *photo* belongs to Log, which owns the request that
 *  persists and reads it. That split is why `still`, `busy` and `error` arrive
 *  as props: the frozen frame has to survive this component unmounting, which
 *  it does every time the user picks TEXT. */

/** The rear camera. The on-device probe found the default rear stream is the
 *  full 12MP sensor (3024×4032 @30fps) — far more than the 1568px long edge
 *  we keep, and heavy to run a live preview from. `ideal` rather than `exact`
 *  so a device that can't honour it still opens a camera instead of throwing.
 *
 *  Barcode mode asks for less again: that probe's explicit warning was not to
 *  feed full-sensor frames to a WASM decoder, and asking for a smaller stream
 *  is the cheapest way to honour it (#13/#15). 1280 still resolves a UPC
 *  comfortably at arm's length.
 *
 *  Since #94 the size is asked for *twice over*: once in the constraints of
 *  the session's single `getUserMedia`, and thereafter with `applyConstraints`
 *  on the track already open. Same intent, no second acquisition — switching
 *  PHOTO↔BARCODE used to re-acquire purely because these two numbers differ,
 *  and on iOS that is a permission prompt for a camera already granted. */
function sizeFor(mode: LogMode): MediaTrackConstraints {
  const edge = mode === "barcode" ? 1280 : 1920;
  return { width: { ideal: edge }, height: { ideal: edge } };
}

function constraintsFor(mode: LogMode): MediaStreamConstraints {
  return { video: { facingMode: { ideal: "environment" }, ...sizeFor(mode) }, audio: false };
}

/** ~3 decodes a second. Fast enough to feel like lock-on, slow enough to
 *  leave the main thread to the preview. */
const SCAN_INTERVAL_MS = 300;

type Finder = "starting" | "live" | "denied" | "unsupported";

/** When the scan loop may run — the whole rule, in one place, and the effect's
 *  only state dependency (#112).
 *
 *  It reads as six conditions and it is really one: *nothing else on this
 *  screen is asking for attention*. Barcode mode, a finder actually producing
 *  frames, no lookup in flight, no frozen frame, no failure still showing —
 *  and, since #112, no read already open on the confirm sheet.
 *
 *  **`reviewing` is the condition that was missing, and the old shape of this
 *  effect is why.** The confirm sheet renders *over* a live viewfinder rather
 *  than replacing it, so a pack left in front of the camera was re-detected
 *  every few hundred milliseconds and each detection rebuilt the sheet from
 *  scratch — discarding whatever had been typed into HOW MUCH. Once #107 made
 *  that number storable, the wipe stopped being cosmetic: it writes the
 *  reader's default into the row as the user's stated amount, which is
 *  indistinguishable afterwards from an untouched save.
 *
 *  The condition was easy to forget because the effect used to name its six
 *  inputs *separately* in its dependency array: adding a condition meant
 *  remembering to add a dependency, by hand, in a second place, and `read` was
 *  added to the screen without ever reaching the array. Folding the rule into
 *  one boolean and depending on **that** makes the two the same statement —
 *  a condition added here cannot fail to be a dependency there, because it is
 *  the dependency. That is the part of this fix that isn't about barcodes.
 *
 *  Two things deliberately absent. **The panel** (#82/#94): `picksOpen` is a
 *  DOM overlay and nothing about it may reach these effects — a decode behind
 *  it is meant to replace it with the sheet. **The code itself**: no same-code
 *  check, because any barcode seen while a sheet is up is either the one
 *  already on screen or one the user cannot act on without dismissing first.
 *  Stopping outright is the smaller rule and it is the correct one; a same-code
 *  no-op would still let a neighbouring pack blow the sheet away, which is this
 *  bug with a rarer trigger. */
export function scanEnabled({
  mode,
  finder,
  busy,
  still,
  error,
  reviewing,
}: {
  mode: LogMode;
  finder: Finder;
  /** A lookup or a read is in flight. */
  busy: boolean;
  /** A frame is frozen on screen. */
  still: boolean;
  /** A failure is showing. Load-bearing: without it the next frame re-reads
   *  the same code and the failure repeats forever. */
  error: boolean;
  /** A read is open on the confirm sheet (#112). Not the same thing as `still`
   *  or `busy` — those describe the *capture*, and a barcode read has no
   *  frozen frame and nothing in flight while it is being reviewed. */
  reviewing: boolean;
}): boolean {
  return mode === "barcode" && finder === "live" && !busy && !still && !error && !reviewing;
}

export function CameraStage({
  mode,
  onMode,
  onClose,
  clock,
  still,
  busy,
  error,
  reviewing,
  onCapture,
  onRetake,
  onScan,
  picksCount,
  onPicks,
}: {
  mode: LogMode;
  onMode: (mode: LogMode) => void;
  onClose: () => void;
  /** "12:38P" — the sketch's compressed meridian, stamped by Log. */
  clock: string;
  /** Object URL of the frame just taken, or null while the finder is live. */
  still: string | null;
  busy: boolean;
  error: string | null;
  /** A read is open on the confirm sheet Log renders over this stage (#112).
   *  The stage stays mounted underneath — the frozen frame has to survive, and
   *  #16's stored photo depends on that state — so the one thing it must not do
   *  is go on scanning behind a sheet it would rebuild. See `scanEnabled`. */
  reviewing: boolean;
  onCapture: (photo: Blob) => void;
  /** Photo mode: discard the frozen frame. Barcode mode: resume scanning
   *  after a lookup that came back empty. */
  onRetake: () => void;
  /** A decoded barcode. Memoise it — it gates the scan loop's effect. */
  onScan: (code: string) => void;
  /** How many favourites/recents are waiting behind the deck button (#82).
   *  Zero renders no button at all, matching TEXT's `picks.length > 0` guard —
   *  an empty state for a list nobody has filled yet is #24's job. */
  picksCount: number;
  /** Open Log's picks panel. Deliberately not a piece of camera state: the
   *  panel is a DOM overlay over a stream that keeps running, and nothing
   *  about it may reach the effects below (#94). */
  onPicks: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Seeded from the session rather than from null: mounting into a camera that
  // is already open (TEXT → PHOTO) should not spend a render on "starting".
  const [stream, setStream] = useState<MediaStream | null>(openCamera);
  const [finder, setFinder] = useState<Finder>("starting");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const live = still === null;

  /** Open the session's camera — **once**, whatever happens afterwards.
   *
   *  The empty dependency list is the whole of #94. This effect used to name
   *  `live` and `mode`, so freezing a frame and switching modes each re-ran it,
   *  and each re-run was a fresh `getUserMedia` (seven per visit, measured).
   *  The mode at mount still picks the constraints — the effect below adjusts
   *  the track in place when it changes. */
  const openingMode = useRef(mode);
  useEffect(() => {
    let cancelled = false;
    acquireCamera(constraintsFor(openingMode.current))
      .then((s) => {
        if (!cancelled) setStream(s);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // NotAllowedError is the user (or a policy) saying no, and it is the
        // one case a settings change can undo. Everything else — no camera,
        // hardware busy, an origin that can't ask — is the same dead end.
        const denied = err instanceof Error && err.name === "NotAllowedError";
        setFinder(denied ? "denied" : "unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Hang the session's stream on this stage's <video>. Detaching on the way
   *  out lets go of the element's handle and nothing else: the stream outlives
   *  the element, which is what makes TEXT → PHOTO free. */
  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video) return;

    video.srcObject = stream;
    // set imperatively as well as in JSX: iOS refuses to autoplay a stream
    // that isn't muted at the moment play() is called
    video.muted = true;

    // "live" waits for the first decoded frame, not for getUserMedia to
    // resolve — between the two the element has no dimensions, and a canvas
    // draw from it yields a blank image rather than an error. Measured:
    // tapping the shutter the instant the stage opened failed exactly here.
    // `loadeddata` is the event that guarantees a frame; `loadedmetadata`
    // only guarantees the size.
    const onFrame = () => setFinder("live");
    if (video.readyState >= 2 && video.videoWidth) onFrame();
    else video.addEventListener("loadeddata", onFrame, { once: true });

    void video.play().catch(() => {});

    return () => {
      video.removeEventListener("loadeddata", onFrame);
      video.srcObject = null;
    };
  }, [stream]);

  /** Frames only while the finder is actually showing one.
   *
   *  This is what replaced tearing the stream down on every freeze. It is a
   *  weaker guarantee and worth being honest about: the capture device stays
   *  open, so the OS indicator is the platform's call, not ours. What it does
   *  guarantee is that no image reaches the page while a read is being
   *  reviewed or a description typed — and unlike stopping the track, coming
   *  back costs nothing. TEXT mode is the case that earns it: the stage
   *  unmounts, this cleanup runs, and the camera sees nothing for however long
   *  someone spends typing. */
  useEffect(() => {
    const tracks = stream?.getVideoTracks() ?? [];
    tracks.forEach((t) => (t.enabled = live));
    return () => tracks.forEach((t) => (t.enabled = false));
  }, [stream, live]);

  /** Barcode mode wants a smaller frame than photo mode (#13/#15). Asking the
   *  open track rather than asking for a new stream is the difference between
   *  a mode switch and a permission prompt. Best-effort by design: a device
   *  that refuses the size still scans, just from a heavier frame. */
  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    void track.applyConstraints(sizeFor(mode)).catch(() => {});
  }, [stream, mode]);

  /** The scan loop (#15). Runs only while `scanEnabled` says so — and that
   *  function, not this array, is where the rule lives (#112). The effect
   *  depends on one boolean and one memoised callback, so there is no list of
   *  conditions here for a seventh one to go missing from. */
  const canScan = scanEnabled({
    mode,
    finder,
    busy,
    still: still !== null,
    error: error !== null,
    reviewing,
  });

  useEffect(() => {
    if (!canScan) {
      setScanning(false);
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    void (async () => {
      let detect;
      try {
        detect = await scanner();
      } catch {
        if (!stopped) setCaptureError("The barcode scanner didn't load. Check your connection, or switch to PHOTO.");
        return;
      }
      if (stopped) return;
      setScanning(true);

      const tick = async () => {
        const video = videoRef.current;
        // readyState guards the same race the shutter does: a video with no
        // decoded frame yet has nothing to read
        if (video && video.readyState >= 2) {
          try {
            const hit = (await detect.detect(video))[0];
            if (hit && !stopped) {
              onScan(hit.rawValue);
              return;
            }
          } catch {
            // a frame with no barcode in it is the overwhelmingly common
            // case, not an error worth surfacing
          }
        }
        if (!stopped) timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [canScan, onScan]);

  async function shoot() {
    const video = videoRef.current;
    if (!video || finder !== "live" || busy) return;
    setCaptureError(null);
    try {
      onCapture(await frameFromVideo(video));
    } catch {
      setCaptureError("That frame didn't come through. Try the shutter again.");
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setCaptureError(null);
    try {
      onCapture(await frameFromFile(file));
    } catch {
      setCaptureError("That image couldn't be read. Try another photo.");
    }
  }

  const scan = mode === "barcode";
  const fallback = finder === "denied" || finder === "unsupported";
  const message = error ?? captureError;
  const hint = busy
    ? scan
      ? "LOOKING IT UP"
      : "READING THE PHOTO"
    : // `reviewing` joins the two states that already had nothing to say: the
      // sheet is the subject and the finder is behind its scrim. Not cosmetic
      // housekeeping — with the loop paused (#112) `scanning` is false, so
      // without this the deck's ring announces "Scanner paused" while the hint
      // beside it reads "STARTING THE SCANNER", and both are in the a11y tree.
      still || message || reviewing
      ? null
      : finder !== "live"
        ? finder === "starting"
          ? "STARTING THE CAMERA"
          : null
        : scan
          ? scanning
            ? "POINT AT THE BARCODE"
            : "STARTING THE SCANNER"
          : "FRAME THE PLATE — AI FILLS THE MACROS";

  return (
    <main className="frame cam">
      <div className="log-top">
        <button className="cam-x" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <span className="eyebrow">
          <span className="tick" />
          Log
        </span>
        <span className="mono">{clock}</span>
      </div>

      <div className="finder">
        {/* rendered unconditionally so the ref exists when getUserMedia
            resolves; `dimmed` is the sketch's own behind-the-sheet treatment,
            reused here so the read runs over the photo it is reading */}
        <video
          ref={videoRef}
          className={finder === "live" && !still ? "cam-video on" : "cam-video"}
          autoPlay
          playsInline
          muted
        />
        {still && <img className="cam-still" src={still} alt="The photo you just took" />}

        {/* Same four corner marks as the sketch; barcode mode pulls them into
            a wide, short window, because that is the shape of the thing being
            aimed at and the framing is the whole instruction. */}
        {!still && !fallback && (
          <div className={scan ? "brackets scan" : "brackets"} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        )}

        {/* No preview to show — but the shutter below still works, handing off
            to the system camera, so this explains rather than offering a
            second button competing with it. */}
        {fallback && !still && (
          <div className="cam-fallback">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none" strokeWidth="1.4" strokeLinecap="round">
              <path d="M3 10a2 2 0 0 1 2-2h3l2-3h10l2 3h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="15" cy="15" r="5" />
            </svg>
            <p>
              {finder === "denied"
                ? "Camera access is off for this site. Turn it on in your browser settings — or tap the shutter to use the system camera."
                : "This browser can't show a live viewfinder. Tap the shutter to use the system camera."}
            </p>
          </div>
        )}

        {busy && (
          <div className="cam-reading" role="status" aria-label="Reading the photo">
            <i />
          </div>
        )}

        {message && (
          <div className="cam-error" role="alert">
            <p>{message}</p>
            {/* A barcode failure has no shutter to fall back on, so it carries
                its own way out. Photographing the panel is the settled answer
                (#15): the label is already in the user's hand, and #14 reads
                panels near-exactly. */}
            {scan && (
              <div className="cam-error-acts">
                <button className="btn btn-accent" onClick={() => onMode("photo")}>
                  Photograph the label
                </button>
                <button className="btn-text" onClick={onRetake}>
                  Scan again
                </button>
              </div>
            )}
          </div>
        )}

        {hint && <span className="cam-hint">{hint}</span>}
      </div>

      <div className="cam-deck">
        <LogModes mode={mode} onMode={onMode} barcodeReady />
        <div className="shutter-row">
          {/* #82: the fastest path in the app used to be reachable only from
              TEXT, which is the one mode nobody lands on. `.shutter-row` is
              `1fr auto 1fr` with the shutter pinned to column 2 and the
              barcode glyph justified into column 3 — column 1 was empty, and
              a star there is symmetric with that glyph rather than a new row
              competing with the viewfinder for height. The count is the label:
              a word wide enough to say "favorites" unbalances the deck. */}
          {picksCount > 0 && (
            <button
              className="deck-picks"
              aria-haspopup="dialog"
              aria-label={`Favorites and recents (${picksCount})`}
              onClick={onPicks}
            >
              <StarGlyph size={22} />
              <span className="mono" aria-hidden="true">
                {picksCount}
              </span>
            </button>
          )}
          {scan ? (
            // Scanning is continuous — there is nothing to press. The ring
            // keeps the deck's geometry so switching modes doesn't jump, but
            // it is a status, not a control.
            <span
              className={scanning && !busy ? "scan-ring on" : "scan-ring"}
              role="status"
              aria-label={
                busy ? "Looking up the barcode" : scanning ? "Scanning for a barcode" : "Scanner paused"
              }
            >
              <i />
            </span>
          ) : still ? (
            <button
              className="shutter"
              aria-label="Retake photo"
              disabled={busy}
              onClick={onRetake}
            >
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none" strokeWidth="2" strokeLinecap="round">
                <path d="M22 13a9 9 0 1 1-2.6-6.4M22 4v5h-5" />
              </svg>
            </button>
          ) : (
            <button
              className="shutter"
              aria-label={fallback ? "Take a photo with the system camera" : "Take photo"}
              disabled={finder === "starting" || busy}
              onClick={fallback ? () => fileRef.current?.click() : () => void shoot()}
            >
              <i />
            </button>
          )}
          <span className={scan ? "barcode-hint on" : "barcode-hint"} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 8V5a1 1 0 0 1 1-1h3M18 4h3a1 1 0 0 1 1 1v3M22 18v3a1 1 0 0 1-1 1h-3M8 22H5a1 1 0 0 1-1-1v-3M8 9v8M12 9v8M15 9v8M18 9v8" />
            </svg>
          </span>
        </div>
      </div>

      {/* the settled fallback, and also the only way to reach the camera at
          all once permission is refused */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </main>
  );
}
