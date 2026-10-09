import type { Page } from "playwright-core";

/**
 * Runs `fn(arg)` in the page, like `page.evaluate`, but with a `__name` helper defined first: tsx
 * (the tests) compiles with esbuild's keepNames, which wraps named inner functions in `__name(...)`
 * calls the page doesn't have (confirmed empirically). The bundle doesn't, and the helper is unused
 * there. `arg` must be JSON.
 */
export function inPage<A, R>(page: Page, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
  return page.evaluate(`(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg)}); })()`) as Promise<R>;
}
