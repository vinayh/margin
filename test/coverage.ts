import { walk } from "@std/fs/walk";
import { fromFileUrl, relative, resolve } from "@std/path";

const DEFAULT_EXCLUDE_SUFFIX = [".test.ts", ".d.ts"];
// Coverage doesn't gain anything useful from these:
//   - `cli/**`     — thin `parseArgs` shells per AGENTS.md; the underlying
//                    logic is in `src/domain/` and is covered there. CLI
//                    entrypoints are also operator tooling, not in the
//                    request path.
//   - `db/migrate.ts` — top-level execution that would fire during import.
const MARGIN_EXCLUDE_PREFIX = ["cli/"];
const MARGIN_EXCLUDE_SUFFIX = ["db/migrate.ts"];

export async function importAllModules(
  dir: string,
  excludePrefix: string[] = [],
  excludeSuffix: string[] = [],
): Promise<void> {
  const suffixes = [...DEFAULT_EXCLUDE_SUFFIX, ...excludeSuffix];
  const files: string[] = [];
  for await (const entry of walk(dir, { exts: [".ts", ".tsx"], includeDirs: false })) {
    const rel = relative(dir, entry.path).replaceAll("\\", "/");
    if (suffixes.some((s) => rel.endsWith(s))) continue;
    if (excludePrefix.some((p) => rel.startsWith(p))) continue;
    files.push(rel);
  }
  await Promise.all(
    files.map((relPath) => import(new URL(relPath, `file://${dir}/`).href)),
  );
}

const here = fromFileUrl(new URL(".", import.meta.url));
await importAllModules(
  resolve(here, "../src"),
  MARGIN_EXCLUDE_PREFIX,
  MARGIN_EXCLUDE_SUFFIX,
);
