/** Extract a human-readable message from an unknown thrown value. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Provider failure whose loggable message intentionally excludes its body. */
export class UpstreamTransportError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${provider}: ${status}`);
    this.name = "UpstreamTransportError";
  }
}
