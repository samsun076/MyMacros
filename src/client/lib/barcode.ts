/** Barcode decoding (#15).
 *
 *  Written against the standard `BarcodeDetector` API. Where the browser
 *  doesn't have it — today that is iOS Safari, with no announced timeline —
 *  `@sec-ant/barcode-detector/pure` supplies a spec-compliant implementation.
 *
 *  Two things make that a small commitment rather than a lasting one:
 *
 *  1. It is imported **dynamically, and only when BARCODE mode opens**, so its
 *     ZXing-WASM payload is a separate chunk that never touches the
 *     cold-launch path (#53's territory) for the photo or text flows.
 *  2. Nothing outside this file names the polyfill. When Safari ships the API,
 *     `native()` starts winning, the dependency comes out of package.json, and
 *     no call site changes.
 *
 *  Decoding runs on the video element directly. That is only safe because
 *  barcode mode asks getUserMedia for a smaller stream — the on-device probe
 *  on #13 found the rear camera defaults to the full 12MP sensor, which is
 *  exactly what a WASM decoder should not be fed thirty times a second.
 */

/** The formats food actually carries: EAN-13/UPC-A on almost everything,
 *  EAN-8/UPC-E on small packages. Narrower than the default set, which makes
 *  each frame cheaper and removes whole classes of misread — a wrong UPC
 *  returns the wrong food rather than an error, so precision beats reach. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** The slice of the standard this app uses. Structural, so the native API and
 *  the polyfill are interchangeable without either being imported for types. */
export type BarcodeScanner = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};

type ScannerCtor = new (options?: { formats?: string[] }) => BarcodeScanner;

let pending: Promise<BarcodeScanner> | null = null;

/** A scanner, loading the polyfill on first use. Memoised: the WASM is fetched
 *  and compiled once per page, not once per mode switch. */
export function scanner(): Promise<BarcodeScanner> {
  pending ??= build().catch((err) => {
    pending = null; // a failed load must not poison every later attempt
    throw err;
  });
  return pending;
}

async function build(): Promise<BarcodeScanner> {
  const Native = native();
  if (Native) return new Native({ formats: FORMATS });

  const [{ BarcodeDetector, setZXingModuleOverrides }, wasm] = await Promise.all([
    import("@sec-ant/barcode-detector/pure"),
    // aliased in vite.config.ts; ?url makes Vite emit the binary as one of
    // our own hashed assets rather than leaving it on a CDN
    import("virtual:zxing-reader.wasm?url"),
  ]);

  // Left alone, the polyfill fetches its WebAssembly from jsdelivr at runtime.
  // That would put a third-party CDN on the critical path of a scan — the same
  // objection #35 raises about the Google Fonts CDN — and break under a strict
  // CSP or offline. Point it at the copy served from our own origin instead.
  setZXingModuleOverrides({ locateFile: () => wasm.default });

  return new BarcodeDetector({ formats: FORMATS as never });
}

function native(): ScannerCtor | undefined {
  return (globalThis as { BarcodeDetector?: ScannerCtor }).BarcodeDetector;
}
