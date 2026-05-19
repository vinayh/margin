import type { Handler, MethodHandlers } from "./route-wrappers.ts";

export type RouteEntry = MethodHandlers | Handler;
export type RouteTable = Record<string, RouteEntry>;

interface CompiledRoute {
  pattern: URLPattern;
  entry: RouteEntry;
}

export interface Dispatcher {
  fetch: (req: Request, info: Deno.ServeHandlerInfo) => Promise<Response>;
  requestIP: (req: Request) => { address: string } | null;
}

/**
 * URLPattern-based route dispatcher. Matches paths via URLPattern
 * (exact + `:param` + `*` wildcard), dispatches to method-keyed handlers,
 * auto-405s on verb mismatch. Routes are tried in insertion order:
 * register exact paths BEFORE their `*` parent to avoid the wildcard
 * swallowing a more-specific match.
 *
 * `requestIP` exposes the remote address per Request so the rate-limit + CORS
 * code can read it without threading `Deno.ServeHandlerInfo` through every
 * handler — the dispatcher caches each request's address in a WeakMap and
 * the adapter looks it up by Request.
 */
export function buildDispatcher(
  table: RouteTable,
  opts: {
    notFound: (req: Request) => Response | Promise<Response>;
    onError: (err: unknown, req: Request) => Response | Promise<Response>;
  },
): Dispatcher {
  const compiled: CompiledRoute[] = Object.entries(table).map(([path, entry]) => ({
    pattern: new URLPattern({ pathname: path }),
    entry,
  }));

  const reqAddr = new WeakMap<Request, string>();

  return {
    requestIP(req) {
      const address = reqAddr.get(req);
      return address ? { address } : null;
    },
    async fetch(req, info) {
      const addr = info.remoteAddr;
      if (addr.transport === "tcp" || addr.transport === "udp") {
        reqAddr.set(req, addr.hostname);
      }
      try {
        for (const route of compiled) {
          if (!route.pattern.test(req.url)) continue;
          const entry = route.entry;
          if (typeof entry === "function") return await entry(req);
          const handler = entry[req.method as keyof MethodHandlers];
          if (!handler) {
            return new Response("method not allowed", {
              status: 405,
              headers: { allow: Object.keys(entry).join(", ") },
            });
          }
          return await handler(req);
        }
        return await opts.notFound(req);
      } catch (err) {
        return await opts.onError(err, req);
      }
    },
  };
}
