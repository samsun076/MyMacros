import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** #94's oracle, in miniature. The browser-side check counts `getUserMedia`
 *  calls across the real screens; this counts them across the session's own
 *  contract, which is the part that has to hold however the components are
 *  rearranged later.
 *
 *  Each test re-imports the module: the session is module state on purpose
 *  (nothing above the log flow lives long enough to hold it), so it has to be
 *  reset the way the browser resets it — by reloading. */

type FakeTrack = { readyState: string; enabled: boolean; stop: () => void };

let calls: MediaStreamConstraints[];
let tracks: FakeTrack[];
let resolveNext: ((stream: MediaStream) => void) | null;
let rejectNext: ((err: unknown) => void) | null;

function fakeStream(): MediaStream {
  const track: FakeTrack = {
    readyState: "live",
    enabled: true,
    stop() {
      this.readyState = "ended";
    },
  };
  tracks.push(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

/** Deferred by default so a test can decide *when* the prompt is answered —
 *  the interesting cases (StrictMode's remount, a release while the sheet is
 *  still up) all live in that window. */
function install({ auto = true } = {}) {
  calls = [];
  tracks = [];
  resolveNext = null;
  rejectNext = null;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia(constraints: MediaStreamConstraints) {
          calls.push(constraints);
          if (auto) return Promise.resolve(fakeStream());
          return new Promise<MediaStream>((res, rej) => {
            resolveNext = res;
            rejectNext = rej;
          });
        },
      },
    },
  });
}

async function load() {
  vi.resetModules();
  return import("./camera");
}

const VIDEO: MediaStreamConstraints = { video: { width: { ideal: 1920 } }, audio: false };

beforeEach(() => {
  vi.useFakeTimers();
  install();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("acquireCamera", () => {
  it("opens the camera once however many times it is asked", async () => {
    const { acquireCamera } = await load();
    await acquireCamera(VIDEO);
    await acquireCamera(VIDEO);
    await acquireCamera(VIDEO);
    expect(calls).toHaveLength(1);
  });

  // The bug in one assertion: the stage re-mounts (TEXT → PHOTO) and the
  // effect runs again. If that opens a second stream, iOS gets a second reason
  // to ask.
  it("hands a re-mounting stage the stream that is already open", async () => {
    const { acquireCamera, openCamera } = await load();
    const first = await acquireCamera(VIDEO);
    expect(openCamera()).toBe(first);
    expect(await acquireCamera(VIDEO)).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("has nothing to hand back before the first ask", async () => {
    const { openCamera } = await load();
    expect(openCamera()).toBe(null);
    expect(calls).toHaveLength(0);
  });

  it("does not ask again after a refusal", async () => {
    install({ auto: false });
    const { acquireCamera } = await load();
    const denied = acquireCamera(VIDEO);
    rejectNext?.(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    await expect(denied).rejects.toThrow();
    await expect(acquireCamera(VIDEO)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("refuses without asking where there is no getUserMedia", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {} });
    const { acquireCamera } = await load();
    await expect(acquireCamera(VIDEO)).rejects.toThrow("no_getusermedia");
  });
});

describe("releaseCamera", () => {
  it("stops every track once the tick has passed", async () => {
    const { acquireCamera, releaseCamera, openCamera } = await load();
    await acquireCamera(VIDEO);
    releaseCamera();
    vi.runAllTimers();
    expect(tracks.map((t) => t.readyState)).toEqual(["ended"]);
    expect(openCamera()).toBe(null);
  });

  // StrictMode: mount, tear down, mount again — all before the tick. A release
  // that took effect immediately would make development report two calls where
  // production reports one, and development is where this gets measured.
  it("survives a release and re-acquire inside the same tick", async () => {
    const { acquireCamera, releaseCamera } = await load();
    await acquireCamera(VIDEO);
    releaseCamera();
    await acquireCamera(VIDEO);
    vi.runAllTimers();
    expect(calls).toHaveLength(1);
    expect(tracks.map((t) => t.readyState)).toEqual(["live"]);
  });

  it("opens a fresh camera for the next visit to the flow", async () => {
    const { acquireCamera, releaseCamera } = await load();
    await acquireCamera(VIDEO);
    releaseCamera();
    vi.runAllTimers();
    await acquireCamera(VIDEO);
    expect(calls).toHaveLength(2);
    expect(tracks.map((t) => t.readyState)).toEqual(["ended", "live"]);
  });

  it("is idempotent", async () => {
    const { acquireCamera, releaseCamera } = await load();
    await acquireCamera(VIDEO);
    releaseCamera();
    releaseCamera();
    releaseCamera();
    vi.runAllTimers();
    expect(tracks.map((t) => t.readyState)).toEqual(["ended"]);
  });

  // Someone opens /log, the permission sheet goes up, and they leave before
  // answering it. The stream still arrives — with nothing left holding it, so
  // it has to stop itself or it runs until the document goes.
  it("stops a stream that arrives after the flow ended", async () => {
    install({ auto: false });
    const { acquireCamera, releaseCamera, openCamera } = await load();
    const late = acquireCamera(VIDEO);
    releaseCamera();
    vi.runAllTimers();
    resolveNext?.(fakeStream());
    await expect(late).rejects.toThrow("camera_released");
    expect(tracks.map((t) => t.readyState)).toEqual(["ended"]);
    expect(openCamera()).toBe(null);
  });
});
