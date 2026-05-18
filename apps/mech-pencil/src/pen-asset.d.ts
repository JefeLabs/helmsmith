/**
 * Ambient: a `.pen` file imported with `with { type: "file" }` resolves
 * to a path string — the real on-disk path in dev/tests, a `$bunfs/…`
 * path after `bun build --compile`. Lets `tsc` accept the generated
 * `frameworks/heroui/library-embed.ts` static asset imports.
 */
declare module '*.pen' {
  const path: string;
  export default path;
}
