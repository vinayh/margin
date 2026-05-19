import { config } from "../config.ts";
import { disallowedOriginResponse, preflight, withCors, withSecurity } from "./cors.ts";
import { authenticateBearer, internalError } from "./middleware.ts";
import { checkRateLimit, clientIp, IP_LIMIT } from "./rate-limit.ts";

// Method-keyed shape lets the dispatcher auto-405 on verb mismatch.
export type Handler = (req: Request) => Response | Promise<Response>;
export type MethodHandlers = Partial<Record<"GET" | "POST" | "OPTIONS", Handler>>;

// Held via setter rather than a closure: wrappers are constructed before the dispatcher is built.
interface ServerWithIP {
  requestIP(req: Request): { address: string } | null;
}
let serverRef: ServerWithIP | null = null;

export function setActiveServer(server: ServerWithIP | null): void {
  serverRef = server;
}

export interface SecuredOptions {
  // Apply the per-user / per-IP rate limiter. Default true.
  // Set false for routes whose senders we don't want to throttle
  // (Better Auth's own /api/auth/*, Google's drive webhook) or that
  // are infrastructure pings (/healthz).
  rateLimit?: boolean;
}

// Applies hardening headers + optional rate-limiting to non-CORS routes.
// Without rate-limiting, attackers could brute-force the magic-link redeem
// (`/r/:token`) and DoS the OAuth bridge endpoints, neither of which sit on
// the CORS path.
export function secured(handler: Handler, opts: SecuredOptions = {}): Handler {
  const rateLimit = opts.rateLimit !== false;
  return async (req) => {
    let remaining: number | null = null;
    if (rateLimit) {
      const gate = await rateLimitGate(req);
      if (gate.kind === "block") return withSecurity(gate.response);
      remaining = gate.remaining;
    }
    const res = await handler(req);
    return withSecurity(attachRateLimitHeader(res, remaining));
  };
}

/**
 * Adds CORS, per-user/IP rate limiting, auto OPTIONS preflight, and a uniform
 * `internalError` fallback to a method-keyed handler table. Routes registered
 * here only need to catch domain exceptions that demand a non-500 mapping.
 */
export function corsRoute(handlers: MethodHandlers): MethodHandlers {
  const out: MethodHandlers = { OPTIONS: preflight };
  for (
    const [method, handler] of Object.entries(handlers) as [
      keyof MethodHandlers,
      Handler,
    ][]
  ) {
    out[method] = async (req: Request) => {
      const blocked = disallowedOriginResponse(req);
      if (blocked) return blocked;
      let res: Response;
      let remaining: number | null = null;
      try {
        const gate = await rateLimitGate(req);
        if (gate.kind === "block") {
          res = gate.response;
        } else {
          remaining = gate.remaining;
          res = await handler(req);
        }
      } catch (err) {
        console.error(`[${method} ${new URL(req.url).pathname}] error:`, err);
        res = internalError();
      }
      return withCors(req, attachRateLimitHeader(res, remaining));
    };
  }
  return out;
}

function attachRateLimitHeader(res: Response, remaining: number | null): Response {
  if (remaining === null) return res;
  if (res.headers.has("x-margin-rate-limit-remaining")) return res;
  const headers = new Headers(res.headers);
  headers.set("x-margin-rate-limit-remaining", String(remaining));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

type RateLimitGate =
  | { kind: "allow"; remaining: number }
  | { kind: "block"; response: Response };

// Keys on authenticated user id when possible, IP otherwise. The IP bucket
// has a higher cap so an unauthenticated burst behind a shared NAT can't
// lock out other authenticated users behind the same egress IP — once auth
// resolves, that user moves into their own per-user bucket.
// Better Auth handles its own /api/auth/* rate limit, so we don't wrap that route.
async function rateLimitGate(req: Request): Promise<RateLimitGate> {
  // Don't pay for a session lookup on uncredentialed requests — that would amplify the DoS
  // surface (the limiter is meant to be cheap).
  const hasBearer = req.headers.has("authorization");
  const session = hasBearer ? await authenticateBearer(req).catch(() => null) : null;
  const { key, limit } = session ? { key: `u:${session.userId}`, limit: undefined } : {
    key: `ip:${clientIp(req, { server: serverRef ?? undefined, trustProxy: config.trustProxy })}`,
    limit: IP_LIMIT,
  };
  const decision = checkRateLimit(key, limit);
  if (!decision.allowed) {
    return {
      kind: "block",
      response: new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(decision.resetSeconds),
          "x-margin-rate-limit-remaining": "0",
        },
      }),
    };
  }
  return { kind: "allow", remaining: decision.remaining };
}
