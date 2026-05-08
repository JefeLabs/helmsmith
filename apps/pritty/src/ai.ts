/**
 * AI client — wraps @agentx/agent-adapter to deliver pritty-shaped
 * operations (commit messages, PR titles, rebase plans, outlier
 * detection). v1 supports Copilot only via the device-flow auth path;
 * OpenAI / Anthropic fallbacks land when consumer demand justifies
 * them. The PRD specifies the cascade — implementation is gated on
 * whether the agent-adapter wraps each provider's auth needs the same
 * way (Copilot uses authPath; the others use API keys).
 */

import { CopilotChatAdapter } from "@agentx/agent-adapter";
import { getAuthPath, readAuth } from "./auth.js";
import type { CategorizedFiles } from "./categorizer.js";
import type { Config } from "./config.js";
import {
  type PullRequestTemplate,
  templatePromptGuidance,
} from "./pr-template.js";
import { ticketPromptGuidance } from "./ticket.js";

export interface TicketContext {
  ticket: string | null;
  link?: string | undefined;
  /** Ticket title from the live adapter, when validation is configured. */
  title?: string | undefined;
}

export interface CommitMessage {
  category: string;
  message: string; // first line, e.g. "feat(api): add /users endpoint"
  body?: string; // optional body paragraph
  files: string[];
}

/**
 * Build a chat adapter for the active provider. Throws when no
 * provider is configured — caller should print actionable next steps
 * (`pritty auth login`).
 */
export async function buildAdapter(model: string): Promise<CopilotChatAdapter> {
  const auth = await readAuth();
  if (!auth.providers["github-copilot"]?.apiKey) {
    throw new Error(
      "No AI provider configured. Run `pritty auth login` to authenticate via GitHub Copilot Device Flow.",
    );
  }
  return new CopilotChatAdapter({
    authPath: getAuthPath(),
    model,
  });
}

/**
 * Strip markdown code-fences and trim whitespace. The Copilot models
 * sometimes wrap JSON output in ```json ... ``` even when the prompt
 * forbids it; this is the standard escape hatch.
 */
function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

const COMMIT_STYLE_GUIDES: Record<Config["commitStyle"], string> = {
  conventional:
    "Format: `<type>(<scope>): <subject>` where type is one of feat|fix|refactor|test|docs|chore|build|ci|perf|style and scope is the affected area in lowercase. Subject is imperative mood, lowercase, no trailing period, max 70 chars.",
  gitmoji:
    "Format: `<emoji> <type>: <subject>`. Use ✨ for feat, 🐛 for fix, ♻️ for refactor, ✅ for test, 📝 for docs, 🧹 for chore.",
  angular:
    "Format: `<type>(<scope>): <subject>` per the Angular commit guidelines. Body explains WHY, not what.",
  simple:
    "One short imperative sentence describing the change. No prefix, no scope. Max 70 chars.",
};

/**
 * Generate one commit message per non-empty category. The model
 * returns JSON which we strip-and-parse. Validation is best-effort:
 * if the model returns a malformed shape, we surface the raw output
 * with the parse error rather than crashing.
 */
export async function generateCommitMessages(
  groups: CategorizedFiles,
  diff: string,
  config: Config,
  ticket?: TicketContext,
): Promise<CommitMessage[]> {
  const adapter = await buildAdapter(config.model);

  // Filter empty buckets so the model doesn't hallucinate messages
  // for them. Bucket the unknown into its own category — the human
  // probably wants to review those manually.
  const nonEmpty = Object.entries(groups).filter(([, files]) => files.length > 0);
  if (nonEmpty.length === 0) return [];

  const filesByCategory = nonEmpty
    .map(([cat, files]) => `## ${cat}\n${files.map((f) => `  - ${f}`).join("\n")}`)
    .join("\n\n");

  const styleGuide = COMMIT_STYLE_GUIDES[config.commitStyle];

  const ticketGuidance = ticket
    ? ticketPromptGuidance(ticket.ticket, ticket.link, ticket.title)
    : "";

  const system = [
    "You are an expert engineer writing git commit messages for a developer.",
    `Produce one commit message per file category. ${styleGuide}`,
    "Return strict JSON: an array of objects with keys `category`, `message`, `body` (optional), `files` (the input files for that category).",
    "Do not wrap the output in markdown code fences. Do not include any prose before or after the JSON.",
    ticketGuidance,
  ].filter((s) => s.length > 0).join("\n");

  const user = [
    "Here are the categorized files:",
    filesByCategory,
    "",
    "Here is the staged diff:",
    "```diff",
    diff.length > 12000 ? `${diff.slice(0, 12000)}\n... (truncated)` : diff,
    "```",
  ].join("\n");

  const raw = await adapter.invoke({ system, user });
  const cleaned = unwrapJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `AI returned non-JSON output:\n${cleaned}\n\nParse error: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`AI returned non-array output: ${cleaned}`);
  }
  return parsed as CommitMessage[];
}

export interface PRDraft {
  title: string;
  body: string;
  labels: string[];
}

export interface CommitSummary {
  hash: string;
  subject: string;
}

/**
 * Generate a pull-request title + body + labels from a commit list.
 * The AI sees the commits and the branch metadata; it returns a single
 * JSON object (not an array). Title is short imperative; body
 * explains scope / motivation / testing; labels are inferred from
 * commit-type prefixes when present (feat/fix/refactor/docs/...).
 */
export async function generatePR(
  commits: readonly CommitSummary[],
  meta: { branch: string; base: string; owner: string; repo: string },
  config: Config,
  ticket?: TicketContext,
  template?: PullRequestTemplate | null,
): Promise<PRDraft> {
  if (commits.length === 0) {
    throw new Error("No commits between base and head — nothing to PR.");
  }

  const adapter = await buildAdapter(config.model);

  const commitList = commits
    .map((c) => `  - ${c.hash.slice(0, 7)}  ${c.subject}`)
    .join("\n");

  const ticketGuidance = ticket
    ? ticketPromptGuidance(ticket.ticket, ticket.link, ticket.title)
    : "";
  const templateGuidance = templatePromptGuidance(template ?? null);

  // When the repo provides a PR template, defer to it for the body
  // structure rather than imposing pritty's default sections. The
  // template's headings + checkboxes are what the team has agreed on;
  // we just fill them in.
  const bodyInstruction = template
    ? "Body: markdown. Use the PR template provided below as the structure — keep its headings, fill its sections."
    : "Body: markdown. Open with a one-paragraph summary of the change. Add a `## Why` section explaining motivation. Add a `## Test plan` checklist when there are non-trivial code changes.";

  const system = [
    "You are an expert engineer writing a pull-request description.",
    "Return strict JSON: { title: string, body: string, labels: string[] }.",
    "Title: short imperative summary, max 70 chars, no trailing period.",
    bodyInstruction,
    "Labels: lowercase, kebab-case, derived from commit types when present (feat → enhancement; fix → bug; docs → documentation; refactor → refactor; test → testing). Empty array is fine.",
    "Do not wrap output in markdown code fences. Do not include any prose outside the JSON.",
    ticketGuidance,
    templateGuidance,
  ].filter((s) => s.length > 0).join("\n");

  const user = [
    `Repository: ${meta.owner}/${meta.repo}`,
    `Branch: ${meta.branch} → ${meta.base}`,
    `Commits (${commits.length}):`,
    commitList,
  ].join("\n");

  const raw = await adapter.invoke({ system, user });
  const cleaned = unwrapJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `AI returned non-JSON output:\n${cleaned}\n\nParse error: ${(err as Error).message}`,
    );
  }
  const draft = parsed as Partial<PRDraft>;
  if (!draft.title || !draft.body) {
    throw new Error(`AI returned malformed PR draft: ${cleaned}`);
  }
  return {
    title: draft.title,
    body: draft.body,
    labels: Array.isArray(draft.labels) ? draft.labels : [],
  };
}

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  hash: string;
  /** What git should do with this commit. */
  action: RebaseAction;
  /** New message when action === "reword" or first "squash" of a group. */
  message?: string;
  /** AI's short reason — shown in the plan preview, not used by git. */
  rationale?: string;
}

export interface RebasePlan {
  /** Steps in OLDEST-first order (git rebase TODO order). */
  steps: RebaseStep[];
  /** Single-paragraph human summary for the preview. */
  summary: string;
}

const REBASE_STRATEGY_GUIDES: Record<Config["rebaseStrategy"], string> = {
  interactive:
    "Propose a clean history. Combine WIP / fixup commits into their parents (fixup), squash closely related commits (squash with a new message), reword unclear messages (reword), drop trivial revert-undo commits when safe (drop). Default action is `pick` (keep as-is).",
  squash:
    "Squash ALL commits into a single commit. First step is `pick`; every subsequent step is `squash`. Provide a clean combined `message` on the first step that summarizes the whole change.",
  fixup:
    "Absorb WIP / fixup commits into their parents using `fixup`. Keep meaningful commits as `pick` and don't combine independent features. The result should drop noise without changing the logical commit count of real work.",
  auto:
    "Decide per commit what's right: `pick` (keep), `squash` (combine with new message), `fixup` (combine, drop message), `reword` (improve message), or `drop` (remove). Aim for a clean, narrative history.",
};

/**
 * Generate a rebase plan over a commit range. Returns steps in
 * OLDEST-FIRST order (matches git rebase TODO conventions). The AI
 * sees the full commit list and a strategy guide; it returns a
 * structured plan we validate before showing the user.
 *
 * Validation enforced here (not the AI's responsibility):
 *   - Every step references a hash in the input set
 *   - First step's action is `pick` (git rejects squash/fixup as the
 *     first step — there's nothing to fold into)
 *   - All input hashes appear in the output (otherwise git would
 *     silently drop them)
 */
export async function generateRebasePlan(
  commits: readonly { hash: string; subject: string }[],
  strategy: Config["rebaseStrategy"],
  config: Config,
): Promise<RebasePlan> {
  if (commits.length === 0) {
    throw new Error("No commits to rebase.");
  }

  const adapter = await buildAdapter(config.model);

  // Git rebase TODOs are oldest-first; commits arrive newest-first
  // from `git log`. Reverse to match the conventional order so the
  // AI plans in the same direction it'll be executed.
  const ordered = [...commits].reverse();
  const commitList = ordered
    .map((c, i) => `  ${i + 1}. ${c.hash.slice(0, 7)}  ${c.subject}`)
    .join("\n");

  const styleGuide = REBASE_STRATEGY_GUIDES[strategy];

  const system = [
    "You are an expert engineer planning an interactive git rebase.",
    `Strategy: ${strategy}. ${styleGuide}`,
    "Return strict JSON: { steps: [{ hash, action, message?, rationale? }], summary }.",
    "  - hash: full SHA from the input list",
    "  - action: one of pick | reword | squash | fixup | drop",
    "  - message: required for reword and (when used) the FIRST step of a squash run",
    "  - rationale: short reason for the action (for human preview only)",
    "Steps must be in the SAME order as the input (oldest-first). Every input commit must appear exactly once.",
    "First step's action MUST be pick — git rejects squash/fixup with no parent to fold into.",
    "Do not wrap output in markdown code fences. Do not include any prose outside the JSON.",
  ].join("\n");

  const user = [
    `Rebase plan needed for ${commits.length} commit(s):`,
    commitList,
  ].join("\n");

  const raw = await adapter.invoke({ system, user });
  const cleaned = unwrapJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `AI returned non-JSON rebase plan:\n${cleaned}\n\nParse error: ${(err as Error).message}`,
    );
  }
  const plan = parsed as Partial<RebasePlan>;
  if (!Array.isArray(plan.steps)) {
    throw new Error(`AI returned malformed rebase plan: missing steps[]`);
  }

  // Validate: every input hash present, in order, no extras
  const inputHashes = ordered.map((c) => c.hash);
  if (plan.steps.length !== inputHashes.length) {
    throw new Error(
      `Plan has ${plan.steps.length} steps but rebase covers ${inputHashes.length} commits.`,
    );
  }
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]!;
    if (!s.hash || !inputHashes.some((h) => h.startsWith(s.hash) || s.hash.startsWith(h))) {
      throw new Error(`Plan step ${i + 1} references unknown hash: ${s.hash}`);
    }
    if (
      s.action !== "pick" &&
      s.action !== "reword" &&
      s.action !== "squash" &&
      s.action !== "fixup" &&
      s.action !== "drop"
    ) {
      throw new Error(`Plan step ${i + 1} has invalid action: ${s.action}`);
    }
  }
  if (plan.steps[0]!.action !== "pick") {
    throw new Error(
      `Plan's first step must be 'pick' (got '${plan.steps[0]!.action}'). git rebase rejects squash/fixup with no parent.`,
    );
  }

  return {
    steps: plan.steps as RebaseStep[],
    summary: typeof plan.summary === "string" ? plan.summary : "",
  };
}
