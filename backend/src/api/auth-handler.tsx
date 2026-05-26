import { Buffer } from "node:buffer";
import { auth } from "../auth/server.ts";
import { db } from "../db/client.ts";
import { session as sessionTable } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { badRequest } from "./middleware.ts";
import { config } from "../config.ts";
import { nonce, renderPage } from "./render.ts";
import { AuthExtSuccessPage } from "./pages/AuthExtSuccessPage.tsx";

export function handleAuthRequest(req: Request): Response | Promise<Response> {
  return auth.handler(req);
}

// Chrome IDs are 32 lowercase a-p chars; Firefox IDs are UUIDs. Reject anything else.
const EXT_ID_PATTERNS: readonly RegExp[] = [
  /^[a-p]{32}$/, // Chrome / Edge
  /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/, // Firefox (UUID, optional braces)
];

function isAllowedExtId(id: string): boolean {
  return EXT_ID_PATTERNS.some((p) => p.test(id));
}

// Single-use binding between `ext` (chosen at /launch-tab) and the OAuth round
// trip. Without this, anyone who knows the URL shape can lure a signed-in
// visitor to /success?ext=<their-extension-id> and harvest the session token
// — the format regex alone doesn't prove the caller initiated the flow.
//
// The nonce is in-memory because Deno.serve is single-process; the TTL is
// short enough that prod restart loss is harmless (OAuth round-trips finish
// in seconds, not minutes). Map iteration is insertion-ordered, so a small
// FIFO prune covers worst-case spam.
interface NonceEntry {
  ext: string;
  expiresAt: number;
}
const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_MAX_ENTRIES = 4096;
const pendingExtNonces = new Map<string, NonceEntry>();

function mintExtNonce(ext: string): string {
  const now = Date.now();
  if (pendingExtNonces.size > NONCE_MAX_ENTRIES) {
    for (const [k, v] of pendingExtNonces) {
      if (v.expiresAt < now) pendingExtNonces.delete(k);
    }
    // Still over the cap (no expired entries to reap) — drop the oldest.
    while (pendingExtNonces.size > NONCE_MAX_ENTRIES) {
      const first = pendingExtNonces.keys().next().value;
      if (first === undefined) break;
      pendingExtNonces.delete(first);
    }
  }
  const buf = crypto.getRandomValues(new Uint8Array(32));
  const value = Buffer.from(buf).toString("base64url");
  pendingExtNonces.set(value, { ext, expiresAt: now + NONCE_TTL_MS });
  return value;
}

function consumeExtNonce(value: string): string | null {
  const entry = pendingExtNonces.get(value);
  if (!entry) return null;
  pendingExtNonces.delete(value);
  if (entry.expiresAt < Date.now()) return null;
  return entry.ext;
}

// Test seam — wipe pending nonces between integration runs.
export function _resetExtNoncesForTests(): void {
  pendingExtNonces.clear();
}

// Test seam — drives the same nonce-store the /launch-tab path uses without
// touching Better Auth. Not for production use.
export const __test_mintExtNonce = mintExtNonce;

/**
 * GET /api/auth/ext/launch-tab?ext=<chrome.runtime.id>
 *
 * Kicks off Google sign-in via a top-level tab. `chrome.identity.launchWebAuthFlow`
 * can't be used: Chrome 122+ stamps the `chrome-extension://` origin onto the OAuth
 * request and Google rejects it on Web-application clients.
 *
 * The caller-supplied `ext` is stored server-side against a single-use nonce
 * that round-trips through the OAuth `callbackURL`. The /success handler can
 * only learn `ext` by consuming that nonce — so an attacker can't lure a
 * signed-in visitor to /success?ext=<their-extension-id> and harvest the
 * token. Without the nonce-binding, the `ext` query parameter is
 * attacker-controlled at the receiving end.
 */
export async function handleAuthExtLaunchTab(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ext = url.searchParams.get("ext");
  if (!ext || !isAllowedExtId(ext)) {
    return badRequest("missing or unrecognized ?ext extension id");
  }

  // Use the configured public origin, not req.url — Host header is attacker-spoofable
  // and would let a forged Host steer the token-bearing bridge page elsewhere.
  // Fail closed when MARGIN_PUBLIC_BASE_URL is unset rather than falling back.
  if (!config.publicBaseUrl) {
    return new Response("server not configured: MARGIN_PUBLIC_BASE_URL is required", {
      status: 500,
    });
  }
  const baseURL = new URL(config.publicBaseUrl);
  baseURL.search = "";
  baseURL.pathname = "/api/auth/ext/success";
  const launchNonce = mintExtNonce(ext);
  const successURL = `${baseURL.toString()}?nonce=${encodeURIComponent(launchNonce)}`;

  const res = await auth.api.signInSocial({
    body: {
      provider: "google",
      callbackURL: successURL,
      disableRedirect: true,
    },
    asResponse: true,
  });

  const body = (await res.json()) as { url?: string };
  if (!res.ok || !body.url) {
    return new Response("sign-in init failed", { status: 502 });
  }

  const redirect = new Response(null, {
    status: 302,
    headers: { location: body.url },
  });
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") redirect.headers.append("set-cookie", v);
  }
  return redirect;
}

/**
 * GET /api/auth/ext/success?nonce=<value>
 *
 * Renders the post-OAuth bridge page. Inlines the raw `session.token` into a script that
 * hands it to the extension. Two delivery paths, picked by feature detection (not UA):
 *  - Chromium: `chrome.runtime.sendMessage(extId, ...)` via the externally_connectable bridge.
 *  - Firefox / fallback: park the token in `location.hash` for the SW's tabs.onUpdated to pick up.
 *
 * `ext` is recovered by consuming the single-use nonce minted at /launch-tab.
 * This prevents an attacker from luring a signed-in visitor to /success with
 * a chosen `ext` and exfiltrating the token via a malicious extension that
 * lists this backend in its `externally_connectable.matches`.
 *
 * Security posture: token-bearing response is `no-store`/noindex, the inline `<script>` is
 * gated by a per-response nonce (no `unsafe-inline`), `frame-ancestors 'none'`.
 */
export async function handleAuthExtSuccess(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const launchNonce = url.searchParams.get("nonce");
  if (!launchNonce) {
    return badRequest("missing nonce");
  }
  const ext = consumeExtNonce(launchNonce);
  if (!ext) {
    // Either never issued, already consumed, or expired. All three look the
    // same to the caller — opaque enough to deter probing.
    return badRequest("invalid or expired nonce");
  }
  // Defense in depth: the nonce store only ever holds format-validated ids,
  // but re-check before inlining into the bridge script.
  if (!isAllowedExtId(ext)) {
    return badRequest("invalid extension id");
  }

  const result = await auth.api.getSession({ headers: req.headers });
  if (!result) {
    return new Response("sign-in did not produce a session", { status: 401 });
  }

  const rows = await db
    .select({ token: sessionTable.token })
    .from(sessionTable)
    .where(eq(sessionTable.id, result.session.id))
    .limit(1);
  const token = rows[0]?.token;
  if (!token) {
    return new Response("session row missing", { status: 500 });
  }

  const n = nonce();
  return renderPage(<AuthExtSuccessPage extId={ext} token={token} nonce={n} />, {
    csp: [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      "style-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
}
