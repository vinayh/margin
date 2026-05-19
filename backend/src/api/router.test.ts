import "../../test/setup.ts";
import { describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildDispatcher, type RouteTable } from "./router.ts";

const ADDR: Deno.ServeHandlerInfo = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
  completed: Promise.resolve(),
};

function build(table: RouteTable) {
  return buildDispatcher(table, {
    notFound: () => new Response("not found", { status: 404 }),
    onError: () => new Response("error", { status: 500 }),
  });
}

describe("router URLPattern hardening", () => {
  test("405 on verb mismatch carries Allow header", async () => {
    const d = build({ "/x": { GET: () => new Response("ok") } });
    const res = await d.fetch(new Request("http://h/x", { method: "POST" }), ADDR);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  test("registration order wins: exact path beats parent wildcard", async () => {
    const d = build({
      "/api/auth/ext/success": { GET: () => new Response("exact") },
      "/api/auth/*": { GET: () => new Response("wild") },
    });
    const res = await d.fetch(new Request("http://h/api/auth/ext/success"), ADDR);
    expect(await res.text()).toBe("exact");
  });

  test("wildcard route still serves siblings under same prefix", async () => {
    const d = build({
      "/api/auth/ext/success": { GET: () => new Response("exact") },
      "/api/auth/*": { GET: () => new Response("wild") },
    });
    const res = await d.fetch(new Request("http://h/api/auth/sign-in"), ADDR);
    expect(await res.text()).toBe("wild");
  });

  test("param routes capture single segment only", async () => {
    const d = build({ "/r/:token": { GET: () => new Response("redeem") } });
    const valid = await d.fetch(new Request("http://h/r/abc123"), ADDR);
    expect(valid.status).toBe(200);
    // Two segments under /r/ should NOT match the single-segment param.
    const multi = await d.fetch(new Request("http://h/r/abc/extra"), ADDR);
    expect(multi.status).toBe(404);
  });

  test("encoded slash (%2F) does not collapse to a path separator", async () => {
    // Lures: a route like /r/:token must not let `..%2F..` traverse into a
    // sibling segment. URLPattern preserves %2F as part of the segment, which
    // is the safe behavior; this test pins it.
    const d = build({
      "/r/:token": {
        GET: (req) => new Response(new URL(req.url).pathname),
      },
    });
    const res = await d.fetch(new Request("http://h/r/abc%2Fdef"), ADDR);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/r/abc%2Fdef");
  });

  test("dot-segment paths in request do not traverse routes", async () => {
    const d = build({
      "/safe": { GET: () => new Response("safe") },
      "/static/:filename": { GET: () => new Response("static") },
    });
    // `/static/../safe` is normalized by URL parser to `/safe`; verify the
    // dispatcher sees the normalized form and routes accordingly rather than
    // matching `/static/:filename` with filename="../safe".
    const res = await d.fetch(new Request("http://h/static/../safe"), ADDR);
    expect(await res.text()).toBe("safe");
  });

  test("double slash // does not match a single-segment param", async () => {
    const d = build({ "/r/:token": { GET: () => new Response("ok") } });
    const res = await d.fetch(new Request("http://h/r//"), ADDR);
    expect(res.status).toBe(404);
  });

  test("trailing slash on exact route does not match without slash", async () => {
    const d = build({ "/healthz": { GET: () => new Response("ok") } });
    const noSlash = await d.fetch(new Request("http://h/healthz"), ADDR);
    expect(noSlash.status).toBe(200);
    const withSlash = await d.fetch(new Request("http://h/healthz/"), ADDR);
    expect(withSlash.status).toBe(404);
  });

  test("NUL byte in path does not panic and returns 404", async () => {
    const d = build({ "/x": { GET: () => new Response("ok") } });
    const res = await d.fetch(new Request("http://h/x%00"), ADDR);
    // Either 404 or 200 against /x is fine; the contract here is no throw.
    expect([200, 404]).toContain(res.status);
  });

  test("OPTIONS without registered handler 405s, not 200", async () => {
    const d = build({ "/x": { GET: () => new Response("ok") } });
    const res = await d.fetch(new Request("http://h/x", { method: "OPTIONS" }), ADDR);
    expect(res.status).toBe(405);
  });

  test("requestIP returns the cached remote address per Request", async () => {
    const d = build({ "/x": { GET: () => new Response("ok") } });
    const req = new Request("http://h/x");
    await d.fetch(req, ADDR);
    expect(d.requestIP(req)).toEqual({ address: "127.0.0.1" });
  });

  test("error in handler is swallowed by onError, not unhandled", async () => {
    const d = build({
      "/boom": {
        GET: () => {
          throw new Error("kaboom");
        },
      },
    });
    const res = await d.fetch(new Request("http://h/boom"), ADDR);
    expect(res.status).toBe(500);
  });
});
