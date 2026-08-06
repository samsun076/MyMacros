import { useEffect, useRef, useState } from "react";
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
 *  so a device that can't honour it still opens a camera instead of throwing. */
const CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1920 },
  },
  audio: false,
};

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
  onRetake: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [finder, setFinder] = useState<Finder>("starting");
  const [captureError, setCaptureError] = useState<string | null>(null);

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
      .getUserMedia(CONSTRAINTS)
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
  }, [live]);

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

  const fallback = finder === "denied" || finder === "unsupported";
  const message = error ?? captureError;
  const hint = busy
    ? "READING THE PHOTO"
    : still
      ? null
      : finder === "live"
        ? "FRAME THE PLATE — AI FILLS THE MACROS"
        : finder === "starting"
          ? "STARTING THE CAMERA"
          : null;

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

        {!still && !fallback && (
          <div className="brackets" aria-hidden="true">
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
          <p className="cam-error" role="alert">
            {message}
          </p>
        )}

        {hint && <span className="cam-hint">{hint}</span>}
      </div>

      <div className="cam-deck">
        <LogModes mode={mode} onMode={onMode} barcodeReady={false} />
        <div className="shutter-row">
          {still ? (
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
          <span className="barcode-hint" aria-hidden="true">
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
