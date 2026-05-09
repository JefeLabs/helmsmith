import { existsSync, readFileSync } from "node:fs";
import { suggestNext, type ActiveWorkflowState } from "../suggest.js";

export interface SuggestOptions {
  limit?: string;
  state?: string;
}

/**
 * Suggest next tasks or workflows after completing <slug>. Reverse
 * edges (`referencedBy`) drive most suggestions; the optional
 * --state path lets the active workflow's positional next-step also
 * factor in.
 */
export function runSuggest(slug: string, options: SuggestOptions = {}): void {
  const limit = options.limit ? Number.parseInt(options.limit, 10) : 8;

  let activeWorkflowState: ActiveWorkflowState | undefined;
  if (options.state && existsSync(options.state)) {
    try {
      const parsed = JSON.parse(readFileSync(options.state, "utf8"));
      if (parsed?.active?.workflow) {
        activeWorkflowState = {
          workflow: parsed.active.workflow,
          currentStep: parsed.active.currentStep,
        };
      }
    } catch (err) {
      console.error(
        `Could not read workflow state at ${options.state}: ${(err as Error).message}`,
      );
    }
  }

  const suggestions = suggestNext(slug, { limit, activeWorkflowState });
  if (suggestions.length === 0) {
    console.log(`No suggestions found for ${slug}.`);
    return;
  }

  console.log(`\nNext steps after ${slug}:\n`);
  for (const s of suggestions) {
    const tag = s.kind === "workflow" ? "[workflow]" : "[task]    ";
    console.log(`  ${tag}  ${s.slug}`);
    console.log(`            ${s.rationale} (score: ${s.score.toFixed(2)})`);
    console.log("");
  }
}
