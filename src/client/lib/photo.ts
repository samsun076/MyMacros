/** Turning a captured frame into the bytes that get uploaded (#13).
 *
 *  The client downscales before the upload. 1568px on the long edge at q0.8
 *  measured 214 KB on device, and that number is what makes a single
 *  authenticated POST the whole upload path — at this size there is nothing
 *  left for a presigned direct-to-R2 upload to save. The same object serves
 *  both the vision call and the timeline thumbnail.
 *
 *  Claude Sonnet 5 accepts 2576px on the long edge, so 1568 is a deliberate
 *  cost choice rather than the model's ceiling (~3× the image tokens at the
 *  limit): portion estimation is about shape and volume, not fine texture.
 *  Raising it for label reads specifically is the lever if those come back
 *  lossy — it needs no contract change. Settled on #13/#14.
 *
 *  Both capture paths land here, which is why the Worker can require
 *  `image/jpeg` rather than guess at whatever a device hands it. */
export const LONG_EDGE = 1568;
export const QUALITY = 0.8;

/** A still off the live viewfinder. */
export function frameFromVideo(video: HTMLVideoElement) {
  return encode(video, video.videoWidth, video.videoHeight);
}

/** A photo from the `<input capture>` fallback — several megabytes of
 *  full-resolution original, downscaled to the same target as a live frame. */
export async function frameFromFile(file: Blob) {
  // from-image, or a portrait photo uploads sideways: the system camera
  // records orientation in EXIF rather than rotating the pixels, and a canvas
  // draws the raw buffer.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return await encode(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function encode(source: CanvasImageSource, srcW: number, srcH: number): Promise<Blob> {
  // a <video> that hasn't produced a frame yet reports 0×0 — capturing it
  // would upload a blank image rather than fail
  if (!srcW || !srcH) return Promise.reject(new Error("empty_frame"));

  const scale = Math.min(1, LONG_EDGE / Math.max(srcW, srcH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no_canvas_context"));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))),
      "image/jpeg",
      QUALITY,
    );
  });
}
