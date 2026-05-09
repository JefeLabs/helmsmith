/**
 * Build the Lambda deployment artifact.
 *
 * Produces `dist/lambda/index.js` - a single bundled JS file that
 * AWS Lambda's nodejs20.x / nodejs22.x runtime can load directly.
 * Externalizes `@aws-sdk/client-s3` because it's pre-installed in
 * the Lambda runtime; bundling it would inflate the ZIP needlessly.
 *
 * Run:
 *   npm run build:lambda
 *
 * Then ZIP the result + catalog.json + .claude/ + TAGS.md and deploy:
 *   cd dist/lambda && zip -r ../lambda.zip . ../../catalog.json ../../TAGS.md ../../.claude
 *
 * The SAM template at deploys/lambda/template.yaml does this packaging
 * for you via `sam build`.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

await build({
  entryPoints: [join(repoRoot, "server", "lambda.ts")],
  // Output as .mjs so Lambda's nodejs20.x runtime recognizes the
  // file as ESM. TLA in lambda.ts (cold-start await of
  // loadServerConfig) requires ESM; CJS doesn't support it.
  outfile: join(repoRoot, "dist", "lambda", "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // The AWS SDK ships with the Lambda runtime; bundling it would add
  // ~10MB to the ZIP for zero benefit. Same for any AWS-provided
  // modules.
  external: [
    "@aws-sdk/*",
    // OpenTUI + React are TUI-only - the Lambda function should never
    // import them. Mark external so any accidental import fails at
    // runtime rather than dragging the dep into the bundle.
    "@opentui/*",
    "react",
    "react-reconciler",
  ],
  sourcemap: true,
  minify: false,
  // Lambda's nodejs runtime supports top-level await (TLA) since
  // Node 18; lambda.ts uses TLA for cold-start initialization. ESM
  // would also work but CJS keeps it simpler for the runtime's
  // module loader.
  banner: {
    js:
      "// skillzkit Lambda artifact - bundled by scripts/build-lambda.ts\n" +
      "// Externalized: @aws-sdk/* (provided by runtime), opentui/react (TUI-only)\n",
  },
  logLevel: "info",
});

console.log(`✓ Wrote ${join(repoRoot, "dist", "lambda", "index.mjs")}`);
