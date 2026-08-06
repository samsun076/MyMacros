import { useRef, useState } from "react";

/** TEMPORARY — M3 decision probe (#13, #14, #15). Remove once the camera
 *  mechanism is settled and Session E has built the real finder.
 *
 *  Three things need answering before Session E writes code, and one tap on a
 *  real device answers all of them:
 *
 *  1. #13 — does getUserMedia actually work in an iOS *standalone* PWA? The
 *     frozen sketch designs a live viewfinder; <input capture> would discard
 *     that screen. Believed fine since iOS 14.3, never verified here, and
 *     standalone has already broken two confident assumptions (#51, #38).
 *  2. #14 — what resolution do we get, and what does a frame weigh once
 *     downscaled to the 1568px long edge the vision model wants? That's the
 *     upload payload, so it decides whether streaming through the Worker is
 *     sensible or whether presigned direct-to-R2 is worth the complexity.
 *  3. #15 — barcode decoding needs frames off a live stream. No frames, no
 *     live scanning, and #15 falls back to photograph-then-decode.
 *
 *  Reports as fixed-width text because it gets read off a phone screenshot. */
export function CameraProbe() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(false);

  const say = (s: string) => setLines((prev) => [...prev, s]);

  async function run() {
    setLines([]);
    say(`secure      ${window.isSecureContext}`);
    say(
      `display     ${window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
    );
    say(`gUM present ${Boolean(navigator.mediaDevices?.getUserMedia)}`);
    if (!navigator.mediaDevices?.getUserMedia) return say("VERDICT     no getUserMedia");

    let s: MediaStream;
    try {
      // ask for more than we need — the browser clamps to what it has, and
      // the clamped result is the answer we're after
      s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 } },
        audio: false,
      });
    } catch (err) {
      const e = err as DOMException;
      say(`FAILED      ${e.name}`);
      say(`            ${e.message}`);
      return say("VERDICT     gUM unavailable — fall back to <input capture>");
    }

    stream.current = s;
    if (video.current) {
      video.current.srcObject = s;
      await video.current.play().catch((e: Error) => say(`play failed ${e.message}`));
    }
    setLive(true);

    const track = s.getVideoTracks()[0];
    const st = track?.getSettings() ?? {};
    say(`stream      ${st.width}x${st.height} @${Math.round(st.frameRate ?? 0)}fps`);
    say(`facing      ${st.facingMode ?? "(unreported)"}`);

    // #14: what a captured frame weighs once downscaled for the vision call
    const v = video.current;
    if (v && v.videoWidth) {
      const LONG = 1568;
      const scale = Math.min(1, LONG / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
      for (const q of [0.8, 0.6]) {
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", q),
        );
        say(`jpeg q${q}    ${w}x${h}  ${blob ? Math.round(blob.size / 1024) : "?"} KB`);
      }
    }
    say("VERDICT     live viewfinder works");
  }

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLive(false);
  }

  return (
    <section>
      <div className="sec-head">
        <span className="eyebrow">Camera probe</span>
        <span className="mono">M3 · temporary</span>
      </div>
      <video ref={video} className="probe-video" playsInline muted hidden={!live} />
      {lines.length > 0 && <pre className="probe-out">{lines.join("\n")}</pre>}
      <button className="btn btn-quiet" onClick={() => void run()}>
        Test camera
      </button>
      {live && (
        <button className="btn btn-text" onClick={stop}>
          Stop the camera
        </button>
      )}
    </section>
  );
}
