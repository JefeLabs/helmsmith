/**
 * Ticket-tracker adapters. Three concrete systems behind a uniform
 * `validate(ticket)` interface:
 *
 *   - jira-rest  — Atlassian Cloud REST API (Basic auth)
 *   - jira-cli   — shell out to the `jira` CLI (uses its own config)
 *   - linear     — Linear GraphQL API (Bearer-style token)
 *
 * Adapter selection is config-driven via a discriminated union.
 * Each adapter handles its own auth resolution from env vars (whose
 * names are configurable to support project-prefixed conventions).
 *
 * All adapters fail open: network errors / unreachable API return
 * null rather than `{ exists: false }`, so transient outages don't
 * block the dev's commit. Strict mode is opt-in at the CLI layer.
 */

export type ValidationType = "jira-rest" | "jira-cli" | "linear";

export interface JiraRestValidation {
  type: "jira-rest";
  /** Atlassian instance URL, e.g. https://yourorg.atlassian.net */
  baseUrl: string;
  /** Env var name for the user email. Default: `JIRA_EMAIL`. */
  emailEnv: string;
  /** Env var name for the API token. Default: `JIRA_API_TOKEN`. */
  tokenEnv: string;
}

export interface JiraCliValidation {
  type: "jira-cli";
}

export interface LinearValidation {
  type: "linear";
  /** Env var name for the API key. Default: `LINEAR_API_KEY`. */
  apiKeyEnv: string;
}

export type ValidationConfig =
  | JiraRestValidation
  | JiraCliValidation
  | LinearValidation;

export interface ValidationResult {
  exists: boolean;
  /** Ticket title / summary, when the API returns one. */
  title?: string;
  /** Status (e.g. "In Progress") for systems that surface it. */
  status?: string;
  /** Browser URL for the ticket — useful in PR bodies. */
  url?: string;
  /** When `exists: false`, a short reason. */
  error?: string;
}

export interface TicketSystemAdapter {
  readonly name: ValidationType;
  /** Returns true when this adapter can run on the current host. */
  isAvailable(): Promise<boolean>;
  /**
   * Validate a ticket. Returns a structured result, or null when the
   * adapter can't reach its backend (network, missing creds). Callers
   * fail open by default.
   */
  validate(ticket: string): Promise<ValidationResult | null>;
}

/**
 * Build the adapter for a given validation config. Throws if the
 * config's type isn't yet implemented — caller should handle that
 * with a clear error message at config-load time.
 */
export async function buildAdapter(
  config: ValidationConfig,
): Promise<TicketSystemAdapter> {
  switch (config.type) {
    case "jira-rest": {
      const { JiraRestAdapter } = await import("./jira-rest.js");
      return new JiraRestAdapter(config);
    }
    case "jira-cli":
      throw new Error(
        "jira-cli adapter not yet implemented — use jira-rest for now.",
      );
    case "linear":
      throw new Error(
        "linear adapter not yet implemented — use jira-rest for now.",
      );
  }
}

/**
 * Best-effort link template derivation from adapter config. When the
 * user doesn't set `linkTemplate` explicitly, this gives a sensible
 * default per system.
 */
export function deriveLinkTemplate(
  config: ValidationConfig,
): string | undefined {
  if (config.type === "jira-rest") {
    return `${config.baseUrl.replace(/\/$/, "")}/browse/{ticket}`;
  }
  return undefined;
}
