import { useCallback, useEffect, useState } from "react";
import { authClient } from "./auth";

/** The one client-side data layer (#48). Every screen talks to the API
 *  through this: JSON in/out, one error shape, and one place that decides
 *  what a 401 means. Policy is refetch-on-mount with no cache — the M2 flow
 *  is navigate-then-read, so nothing holds stale data while another screen
 *  mutates it. Add invalidation only when something actually hurts. */

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 when the request never reached the server. */
    readonly status: number,
    /** The worker's error code ("invalid_fields", …) or "network". */
    readonly code: string,
    /** The error response body, when there was one. */
    readonly detail?: unknown,
  ) {
    super(`${code} (${status})`);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData carries the photo upload (#13). The browser has to set the
  // content-type itself there — it's multipart with a generated boundary, and
  // naming it ourselves would produce a body the Worker can't parse.
  const form = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined || form ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network");
  }

  if (res.status === 401) {
    // Session died mid-use. Poke the session store so App's gate re-checks
    // and swaps to the sign-in screen — screens never have to interpret a
    // 401 themselves.
    authClient.$store.notify("$sessionSignal");
    throw new ApiError(401, "unauthorized");
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof code === "string" ? code : "request_failed", data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  postForm: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Fetch-on-mount for read routes — the pattern every screen copies. Refetches
 *  whenever `path` changes; `reload` refetches in place (e.g. after a save). */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .get<T>(path)
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e : new ApiError(0, "network")));
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}
