/**
 * Preact SSR helper for the backend HTML pages. Each route builds a
 * VNode (typed props, JSX-default escaping) and `renderPage` wraps it
 * with the standard response headers + per-route CSP.
 *
 * `nonce()` returns a base64-ish identifier suitable for `script-src
 * 'nonce-…'`. The route handler generates one per response, passes it
 * to the component that renders the inline `<script>`, and embeds the
 * same value in the CSP header.
 */

import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

export interface RenderPageOptions {
  status?: number;
  csp: string;
  cacheControl?: string;
}

export function renderPage(vnode: VNode, opts: RenderPageOptions): Response {
  const body = renderToString(vnode);
  return new Response(`<!doctype html>${body}`, {
    status: opts.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": opts.cacheControl ?? "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": opts.csp,
    },
  });
}

export function nonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// Regex constructed via `new RegExp` so the U+2028 / U+2029 code points
// don't appear literally in source (they're line terminators that break
// most editors and JS regex literals).
const U2028_RE = new RegExp("\\u2028", "g");
const U2029_RE = new RegExp("\\u2029", "g");

/**
 * Serialize a value to a JSON literal safe to embed inside an inline
 * `<script>`. `JSON.stringify` alone is not enough: `</script>` and `<!--`
 * are valid inside JSON strings and would terminate the script tag (or open
 * an HTML comment that swallows trailing markup) if the value ever contained
 * them. We post-process those two sequences plus the `U+2028` / `U+2029`
 * line separators (which break ES5 string literals).
 *
 * Callers should still emit the script with a CSP nonce — this helper closes
 * the breakout vector but isn't a substitute for `script-src 'nonce-…'`.
 */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--")
    .replace(U2028_RE, "\\u2028")
    .replace(U2029_RE, "\\u2029");
}
