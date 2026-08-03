/**
 * Test-only ESM resolve hook (validation harness ONLY — never the app build).
 *
 *  1. `server-only` / `client-only` are Next.js build-time guard packages not
 *     resolvable by a plain Node process; map them to an empty module so server
 *     modules' pure logic can be unit-tested outside Next.
 *  2. The `@/` path alias (tsconfig `paths`) maps to the repo root; rewrite it to
 *     an absolute file URL so imported lib modules resolve.
 *  3. lib/ uses extensionless relative/alias imports (bundler style); retry a
 *     failed one with a `.ts` extension.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
  }

  // `@/foo/bar` -> <repo>/foo/bar (with a `.ts` fallback).
  if (specifier.startsWith("@/")) {
    const base = pathToFileURL(resolvePath(REPO_ROOT, specifier.slice(2))).href;
    const hasExt = /\.[a-z]+$/i.test(specifier);
    for (const candidate of hasExt ? [base] : [base + ".ts", base]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        /* try next */
      }
    }
  }

  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      /* fall through */
    }
  }
  return nextResolve(specifier, context);
}
