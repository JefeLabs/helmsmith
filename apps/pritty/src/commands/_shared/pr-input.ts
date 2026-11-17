import { z } from 'zod';

/** What `pr --input=json` wants on stdin. */
const PR_STDIN_HINT = 'expected a JSON document on stdin: { "title": "…", "body": "…" }';

const prShape = z.object({
  title: z.string().min(1, 'title must not be empty'),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
});

export type PrInput = z.infer<typeof prShape>;

/** Parse the PR a JSON body describes; output-only keys (`dryRun`, `number`, `url`, …) and unknown keys are ignored. */
export function parsePrInput(text: string): PrInput {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(PR_STDIN_HINT);
  }
  const parsed = prShape.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('\n'),
    );
  }
  return parsed.data;
}
