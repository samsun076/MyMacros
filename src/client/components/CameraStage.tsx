import { useEffect, useRef, useState } from "react";
import { scanner } from "../lib/barcode";
import { frameFromFile, frameFromVideo } from "../lib/photo";
import { LogModes, type LogMode } from "./LogModes";

/** The camera stage, ported from sketches/e-log-flow.html#camera — brackets,
 *  shutter, mode deck — built around a real <video> (#13).
 *
 *  Mechanism settled on #13 and verified on the device rather than from
 *  documentation: a getUserMedia viewfinder, with `<input capture>` as the
 *  fallback for when the API is absent or the permission is refused. The
 *  sketch's own markup is commented "straight to the viewfinder", so handing
 *  the screen to iOS's camera app would mean never showing a designed screen.
 *
 *  The stage owns the camera; the *photo* belongs to Log, which owns the
 *  request that persists and reads it. That split is why `still`, `busy` and
 *  `error` arrive as props: the frozen frame has to survive this component
 *  tearing its stream down. */

/** The rear camera. The on-device probe found the default rear stream is the
 *  full 12MP sensor (3024×4032 @30fps) — far more than the 1568px long edge
 *  we keep, and heavy to run a live preview from. `ideal` rather than `exact`
 *  so a device that can't honour it still opens a camera instead of throwing.
 *
 *  Barcode mode asks for less again: that probe's explicit warning was not to
 *  feed full-sensor frames to a WASM decoder, and asking getUserMedia for a
 *  smaller stream is the cheapest way to honour it (#13/#15). 1280 still
 *  resolves a UPC comfortably at arm's length. */
function constraintsFor(mode: LogMode): MediaStreamConstraints {
  const edge = mode === "barcode" ? 1280 : 1920;
  return {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: edge },
      height: { ideal: edge },
    },
    audio: false,
  };
}

/** ~3 decodes a second. Fast enough to feel like lock-on, slow enough to
 *  leave the main thread to the preview. */
const SCAN_INTERVAL_MS = 300;

type Finder = "starting" | "live" | "denied" | "unsupported";

export function CameraStage({
  mode,
  onMode,
  onClose,
  clock,
  still,
  busy,
  error,
  onCapture,
  onRetake,
  onScan,
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
  onCapture: (photo: Blob) => void;
  /** Photo mode: discard the frozen frame. Barcode mode: resume scanning
   *  after a lookup that came back empty. */
  onRetake: () => void;
  /** A decoded barcode. Memoise it — it gates the scan loop's effect. */
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [finder, setFinder] = useState<Finder>("starting");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // The stream runs only while the finder is actually showing. Freezing a
  // frame tears it down, which is what puts the camera indicator out while
  // the read is reviewed; retaking starts it again (no second permission
  // prompt — the grant is already on the origin).
  const live = still === null;

  useEffect(() => {
    if (!live) return;

    // undefined on an insecure origin as well as an old browser — either way
    // there is no live viewfinder to be had here
    if (!navigator.mediaDevices?.getUserMedia) {
      setFinder("unsupported");
      return;
    }

    let stream: MediaStream | null = null;
    let mounted = true;
    let video: HTMLVideoElement | null = null;
    let onFrame: (() => void) | null = null;
    setFinder("starting");

    navigator.mediaDevices
      .getUserMedia(constraintsFor(mode))
      .then((s) => {
        if (!mounted) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        // set imperatively as well as in JSX: iOS refuses to autoplay a
        // stream that isn't muted at the moment play() is called
        video.muted = true;

        // "live" waits for the first decoded frame, not for getUserMedia to
        // resolve — between the two the element has no dimensions, and a
        // canvas draw from it yields a blank image rather than an error.
        // Measured: tapping the shutter the instant the stage opened failed
        // exactly here. `loadeddata` is the event that guarantees a frame;
        // `loadedmetadata` only guarantees the size.
        onFrame = () => mounted && setFinder("live");
        if (video.readyState >= 2 && video.videoWidth) onFrame();
        else video.addEventListener("loadeddata", onFrame, { once: true });

        void video.play().catch(() => {});
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        // NotAllowedError is the user (or a policy) saying no, and it is the
        // one case a settings change can undo. Everything else — no camera,
        // hardware busy, an origin that can't ask — is the same dead end.
        const denied = err instanceof Error && err.name === "NotAllowedError";
        setFinder(denied ? "denied" : "unsupported");
      });

    return () => {
      mounted = false;
      if (video && onFrame) video.removeEventListener("loadeddata", onFrame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // mode is a dependency because barcode mode asks for a different stream
  }, [live, mode]);

  /** The scan loop (#15). Runs only while barcode mode is showing a live
   *  finder with nothing pending — so a lookup in flight, or one that came
   *  back empty, pauses it. That pause is load-bearing: without it the next
   *  frame re-reads the same code and the failure repeats forever. */
  useEffect(() => {
    if (mode !== "barcode" || finder !== "live" || busy || still || error) {
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
  }, [mode, finder, busy, still, error, onScan]);

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
    : still || message
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
