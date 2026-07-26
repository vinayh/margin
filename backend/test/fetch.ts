/**
 * Centralize the `typeof fetch` cast so tests can install a plain async fake
 * without repeating `as unknown as typeof fetch` at every call site.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function setFetch(fn: FetchLike): void {
  globalThis.fetch = fn as unknown as typeof fetch;
}

/**
 * Build a `Request` for an API route test. `body` may be a string (passed
 * through verbatim) or any JSON-serializable value. `opts.auth` sets the
 * Authorization header literally — pass `"Bearer <token>"` or an empty
 * string to exercise the missing-auth path.
 */
export function postJsonRequest(
  path: string,
  body: unknown,
  opts?: { auth?: string },
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts?.auth !== undefined) headers.set("authorization", opts.auth);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
