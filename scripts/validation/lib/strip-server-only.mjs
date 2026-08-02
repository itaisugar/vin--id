/**
 * Test-only ESM resolve hook.
 *
 *  1. `server-only` / `client-only` are Next.js build-time guard packages not
 *     resolvable by a plain Node process. Server modules under lib/ legitimately
 *     import them; we map those specifiers to an empty module so their pure logic
 *     can be unit-tested outside Next.
 *  2. The lib/ sources use extensionless relative imports (bundler style, e.g.
 *     `./normalize-registration`). Node ESM needs an explicit extension, so we
 *     retry a failed extensionless relative specifier with `.ts`.
 *
 * This affects the validation harness ONLY — never the app build.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
  }
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      // fall through to the default resolution below
    }
  }
  return nextResolve(specifier, context);
}
