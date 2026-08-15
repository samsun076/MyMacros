/** One camera session per visit to the log flow (#94).
 *
 *  The stage used to open its own stream inside an effect keyed on the two
 *  things that change *during* the flow — which mode is showing, and whether a
 *  frame is currently frozen — so each of those re-ran the effect, and every
 *  re-run is another `getUserMedia`. Measured on the real screens before this
 *  file existed: **seven** calls for one visit that took a photo, dismissed the
 *  sheet, and toured the three modes. Each one is a chance for iOS to put the
 *  permission sheet back up, which is what #94 reports.
 *
 *  So the session is held here rather than by any component. Nothing above it
 *  unmounts until the flow itself ends — `Log` releases on its way out, which
 *  is the one moment the camera should actually go out. TEXT mode unmounts the
 *  whole camera stage, and that deliberately does *not* release: coming back to
 *  PHOTO would otherwise be a second prompt for a session the user never left.
 *
 *  **Release is deferred by a tick, and that is load-bearing.** React's
 *  StrictMode mounts every effect, tears it down and mounts it again; stopping
 *  the tracks synchronously in between would leave the second pass with nothing
 *  and it would open a new stream. Deferring lets the re-acquire cancel the
 *  close, so development and production make the same single call — which
 *  matters, because development is where this gets measured.
 */

/** The in-flight or settled acquisition. Deliberately kept after a rejection
 *  too: a refused permission is an answer, and asking again is the prompt this
 *  file exists to avoid. The way back is the `<input capture>` fallback the
 *  stage already offers, or leaving the flow — releasing clears this. */
let session: Promise<MediaStream> | null = null;
let open: MediaStream | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
/** Bumped by every close, so a stream that arrives *after* one — the user took
 *  their time over the prompt and then the flow ended — is stopped rather than
 *  left running with nothing holding it. */
let era = 0;

/** The session's stream, opening it on the first ask. `constraints` are used
 *  only by that first ask; a stream already open is adjusted with
 *  `applyConstraints`, which costs no second acquisition. */
export function acquireCamera(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (closing !== null) {
    clearTimeout(closing);
    closing = null;
  }
  if (session) return session;

  // undefined on an insecure origin as well as on an old browser — either way
  // there is no live viewfinder to be had here, and nothing to prompt for
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return Promise.reject(new Error("no_getusermedia"));

  const mine = era;
  session = media.getUserMedia(constraints).then((stream) => {
    if (mine !== era) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("camera_released");
    }
    open = stream;
    return stream;
  });
  return session;
}

/** The stream if one is already open, for a component mounting into a session
 *  already in progress. TEXT → PHOTO remounts the stage, and waiting even a
 *  microtask for a promise that settled minutes ago shows "STARTING THE
 *  CAMERA" for a frame over a camera that never stopped. */
export function openCamera(): MediaStream | null {
  return open;
}

/** End the session. Idempotent, and deferred — see the note above on why the
 *  tick is not an accident. */
export function releaseCamera(): void {
  if (closing === null) closing = setTimeout(close, 0);
}

function close() {
  closing = null;
  era++;
  open?.getTracks().forEach((t) => t.stop());
  open = null;
  session = null;
}
