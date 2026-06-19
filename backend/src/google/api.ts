export interface TokenProvider {
  getAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    // Message intentionally omits `body`: this error propagates through
    // `console.error` in `route-wrappers.ts`, and Drive responses can
    // include file names and parent ids that shouldn't reach shared logs.
    // Callers that need the body have it as a public field.
    super(`${status} ${url}`);
    this.name = "GoogleApiError";
  }
}

// Hard ceiling per request attempt. Google export/list calls normally finish in
// well under a second; this only fires when a connection hangs open without
// erroring, which would otherwise stall callers indefinitely (the polling loop
// runs versions serially, so one hung export blocks every version after it).
const REQUEST_TIMEOUT_MS = 60_000;

export async function authedFetch(
  tp: TokenProvider,
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  // The 401 retry re-uses `init` verbatim, so `init.body` must be replayable.
  // Strings, Uint8Array, ArrayBuffer, FormData, URLSearchParams, Blob are
  // fine; a ReadableStream would be consumed by the first send and the retry
  // would silently transmit an empty body.
  if (init.body instanceof ReadableStream) {
    throw new TypeError("authedFetch: init.body must be replayable, got ReadableStream");
  }
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    // Fresh timeout per attempt. Combine with any caller signal so an
    // explicit abort still works. Rejects with a TimeoutError on expiry,
    // which callers handle like any other fetch failure.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(url, { ...init, headers, signal });
  };

  let res = await send(await tp.getAccessToken());
  if (res.status === 401) {
    res = await send(await tp.refreshAccessToken());
  }
  return res;
}

export async function authedJson<T>(
  tp: TokenProvider,
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(tp, url, init);
  if (!res.ok) {
    throw new GoogleApiError(res.status, String(url), await res.text());
  }
  return res.json() as Promise<T>;
}
