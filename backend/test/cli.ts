/**
 * Run `deno run … src/cli/index.ts <args…>` as a subprocess. The child
 * inherits `DATABASE_URL` + `MARGIN_MASTER_KEY` + `BETTER_AUTH_SECRET` from
 * the parent test process; the URL points at the PGlite-backed socket
 * server started in `test/setup.ts`, so the subprocess hits the same DB
 * over real `pg`. `env` overrides individual vars; pass `undefined` to
 * unset a single variable in the child.
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const PERMISSIONS = [
  "--allow-env",
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-sys",
];

export async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<CliResult> {
  const childEnv: Record<string, string> = { ...Deno.env.toObject() };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", ...PERMISSIONS, "src/cli/index.ts", ...args],
    env: childEnv,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const decoder = new TextDecoder();
  return {
    stdout: decoder.decode(out.stdout),
    stderr: decoder.decode(out.stderr),
    exitCode: out.code,
  };
}
