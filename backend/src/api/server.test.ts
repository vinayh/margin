import "../../test/setup.ts";
import { beforeEach, describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { startServer } from "./server.ts";
import { _resetRateLimitForTests, IP_LIMIT } from "./rate-limit.ts";

beforeEach(_resetRateLimitForTests);

/**
 * Smoke-tests for the route table and background-loop wiring. We bind to
 * port 0 so each run gets a free OS-assigned port — running tests in
 * parallel with `deno test` would otherwise step on one another.
 *
 * Deno's leak detector fails the file if a fetch Response body is left
 * unread, so every fetch below either consumes the body or cancels it.
 */
describe("startServer route table", () => {
  test("/healthz responds 200 with { ok: true }", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const res = await fetch(`http://${server.hostname}:${server.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await server.stop();
    }
  });

  test("/api/picker/register-doc 401s without an Authorization header", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const res = await fetch(
        `http://${server.hostname}:${server.port}/api/picker/register-doc`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docUrlOrId: "abc" }),
        },
      );
      expect(res.status).toBe(401);
      await res.body?.cancel();
    } finally {
      await server.stop();
    }
  });

  test("OPTIONS preflight on /api/picker/register-doc returns 204", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const res = await fetch(
        `http://${server.hostname}:${server.port}/api/picker/register-doc`,
        {
          method: "OPTIONS",
          headers: {
            origin: `chrome-extension://${"a".repeat(32)}`,
            "access-control-request-method": "POST",
          },
        },
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      await res.body?.cancel();
    } finally {
      await server.stop();
    }
  });

  test("/r/<token> path is registered and renders the confirm page", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const res = await fetch(
        `http://${server.hostname}:${server.port}/r/mra_unknown?action=mark_reviewed`,
      );
      // GET is pure render under the POST-redeem flow; the route resolves
      // and emits the confirm page even for an unknown token (the redeem
      // attempt on POST is what surfaces the 404).
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain('method="POST"');
    } finally {
      await server.stop();
    }
  });

  test("unknown path falls through to 404", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const res = await fetch(`http://${server.hostname}:${server.port}/no-such-route`);
      expect(res.status).toBe(404);
      await res.body?.cancel();
    } finally {
      await server.stop();
    }
  });

  test("extension routes set x-margin-rate-limit-remaining and decrement on each call", async () => {
    // Unauthenticated requests key into the IP bucket (limit `IP_LIMIT`, 5x
    // the authenticated 120/min cap). Two requests should show the bucket
    // decrementing.
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const a = await fetch(
        `http://${server.hostname}:${server.port}/api/picker/register-doc`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(a.status).toBe(401);
      const remA = Number(a.headers.get("x-margin-rate-limit-remaining"));
      expect(remA).toBe(IP_LIMIT - 1);
      await a.body?.cancel();

      const b = await fetch(
        `http://${server.hostname}:${server.port}/api/picker/register-doc`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(b.status).toBe(401);
      expect(Number(b.headers.get("x-margin-rate-limit-remaining"))).toBe(
        IP_LIMIT - 2,
      );
      await b.body?.cancel();
    } finally {
      await server.stop();
    }
  });

  test("burning the full IP budget yields 429 with Retry-After", async () => {
    // Real fetches against the running server so the bucket key — keyed on
    // the socket-level IP that Deno.serve hands rateLimitGate via
    // `server.requestIP(req)` — matches what the test is exercising.
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const url = `http://${server.hostname}:${server.port}/api/picker/register-doc`;
      const fire = () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      // Burn the unauthenticated IP budget. The (limit+1)th request must be
      // rejected by the limiter, ahead of the handler's own 401.
      for (let i = 0; i < IP_LIMIT; i++) {
        const ok = await fire();
        await ok.body?.cancel();
      }
      const r = await fire();
      expect(r.status).toBe(429);
      expect(await r.json()).toEqual({ error: "rate_limited" });
      const retryAfter = Number(r.headers.get("retry-after"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(r.headers.get("x-margin-rate-limit-remaining")).toBe("0");
    } finally {
      await server.stop();
    }
  });

  test("security headers are stamped on both CORS and non-CORS responses", async () => {
    // Easy thing to silently regress — if the secured() wrapper or
    // applySecurityHeaders in cors.ts gets dropped, lock the floor.
    const server = startServer({ port: 0, backgroundLoops: false });
    try {
      const expected = {
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "cross-origin-opener-policy": "same-origin",
      };
      const healthz = await fetch(`http://${server.hostname}:${server.port}/healthz`);
      for (const [k, v] of Object.entries(expected)) {
        expect(healthz.headers.get(k)).toBe(v);
      }
      await healthz.body?.cancel();
      const preflight = await fetch(
        `http://${server.hostname}:${server.port}/api/picker/register-doc`,
        { method: "OPTIONS", headers: { origin: `chrome-extension://${"a".repeat(32)}` } },
      );
      for (const [k, v] of Object.entries(expected)) {
        expect(preflight.headers.get(k)).toBe(v);
      }
      await preflight.body?.cancel();
    } finally {
      await server.stop();
    }
  });
});

describe("startServer background loops", () => {
  test("backgroundLoops:false boots clean and stops without dangling timers", async () => {
    const server = startServer({ port: 0, backgroundLoops: false });
    await server.stop();
    // If a setInterval slipped through, Deno's leak detector would fire on
    // the open handle keeping the test process alive. Reaching this line is
    // the assertion.
    expect(true).toBe(true);
  });

  test("backgroundLoops on with no MARGIN_PUBLIC_BASE_URL is a no-op", async () => {
    // .env doesn't set MARGIN_PUBLIC_BASE_URL during `deno test`, so the
    // loop initializer logs "skipping" and schedules nothing. Just verify
    // the server still boots and stops.
    const original = Deno.env.get("MARGIN_PUBLIC_BASE_URL");
    Deno.env.delete("MARGIN_PUBLIC_BASE_URL");
    try {
      const server = startServer({ port: 0, backgroundLoops: true });
      await server.stop();
      expect(true).toBe(true);
    } finally {
      if (original !== undefined) Deno.env.set("MARGIN_PUBLIC_BASE_URL", original);
    }
  });
});
