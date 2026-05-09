#!/usr/bin/env node
/**
 * Thin CLI wiring layer. Each verb's logic lives in
 * `lib/commands/<verb>.ts` (see lib/commands/_shared/ for helpers
 * used by multiple commands). This file's job is option parsing +
 * delegation, nothing more.
 *
 * Pattern intentionally mirrors gitradar's src/commands/* — anyone
 * navigating the toolbox should find verb logic in the same place
 * across every app.
 */
import { cac } from "cac";
import { runConfigCommand } from "../lib/commands/config.js";
import { runContributeCommand } from "../lib/commands/contribute.js";
import { runDoctorCommand } from "../lib/commands/doctor.js";
import { runInitCommand } from "../lib/commands/init.js";
import { runInstall } from "../lib/commands/install.js";
import { runList, type ListOptions } from "../lib/commands/list.js";
import { runSearch, type SearchOptions } from "../lib/commands/search.js";
import { runServe } from "../lib/commands/serve.js";
import { runShow } from "../lib/commands/show.js";
import { runSuggest, type SuggestOptions } from "../lib/commands/suggest.js";
import { runTags } from "../lib/commands/tags.js";
import { runUi } from "../lib/commands/ui.js";
import { runVersion } from "../lib/commands/version.js";

const cli = cac("skillzkit");

cli
  .command("list", "List commands, skills, and workflows in the catalog")
  .option("--commands", "Show only commands")
  .option("--skills", "Show only skills")
  .option("--workflows", "Show only workflows")
  .option("--kind <kind>", "Filter commands by kind: command|workflow|context")
  .option("--tree", "Render commands hierarchically by slug namespace")
  .option(
    "--tag <name>",
    "Filter to artifacts carrying this tag (cross-persona discovery)",
  )
  .action((options: ListOptions) => runList(options));

cli
  .command(
    "search <query>",
    "Find commands, workflows, and skills whose slug, description, or tags match",
  )
  .option("--limit <n>", "Maximum results per kind (default 10)")
  .action((query: string, options: SearchOptions) => runSearch(query, options));

cli
  .command("show <slug>", "Print one command, skill, or workflow body by slug or name")
  .action((slug: string) => runShow(slug));

cli
  .command(
    "serve",
    "Run the skillzkit REST API locally (Bun-backed). Defaults to fs:auto storage against this repo.",
  )
  .option("--port <port>", "Listen port (default: 3000)")
  .option(
    "--storage <spec>",
    "Storage backend: memory | fs:<path> | fs-persistent:<path> | s3:<bucket> (default: fs:auto)",
  )
  .action((options: { port?: string; storage?: string }) => runServe(options));

cli
  .command("ui", "Launch the interactive installer (requires bundled Bun runtime)")
  .option("--target <path>", "Target directory (default: current working directory)")
  .action(async (options: { target?: string }) => runUi(options));

cli
  .command(
    "install [...slugs]",
    "Install all catalog items (no args), OR specific slugs/groups + transitive deps. Accepts: bare persona (product/engineer/market), wildcard prefix (core:tools:*, product:strategy:*), exact slug (core:tools:npm), or skill name (skillzkit-product-router).",
  )
  .option("--target <path>", "Target directory (default: current working directory)")
  .option("--force", "Overwrite existing files in the target")
  .option("--dry-run", "Print the resolved install plan without copying files")
  .action(
    (
      slugs: string[],
      options: { target?: string; force?: boolean; dryRun?: boolean },
    ) => runInstall(slugs, options),
  );

cli
  .command(
    "suggest <slug>",
    "Suggest next tasks or workflows after completing <slug>",
  )
  .option("--limit <n>", "Maximum suggestions to print (default 8)")
  .option(
    "--state <path>",
    "Path to .pencil-workflow-state.json for active-workflow signal",
  )
  .action((slug: string, options: SuggestOptions) =>
    runSuggest(slug, options),
  );

cli
  .command(
    "doctor",
    "Health check the kit — broken references, orphan files, frontmatter completeness, prerequisite resolution",
  )
  .option("--errors-only", "Show only error-severity findings")
  .action((options: { errorsOnly?: boolean }) => runDoctorCommand(options));

cli
  .command(
    "init",
    "First-run setup — creates ~/.agentx/skillzkit/config.json. Interactive when called without args; pass flags to skip prompts.",
  )
  .option("--mode <mode>", "standalone | team")
  .option(
    "--email <email>",
    "Your email (required, used for local artifact attribution and team-mode identity)",
  )
  .option("--api-url <url>", "Team mode: skillzkit API base URL")
  .option("--api-key <key>", "Team mode: API key from agentx-controlplane")
  .option(
    "--pin <pin>",
    "Team mode: PIN that encrypts the API key at rest (min 6 chars)",
  )
  .option("--force", "Overwrite an existing config")
  .action(
    async (cliOpts: {
      mode?: "standalone" | "team";
      email?: string;
      apiUrl?: string;
      apiKey?: string;
      pin?: string;
      force?: boolean;
    }) => runInitCommand(cliOpts),
  );

cli
  .command(
    "config [field] [value]",
    "View or update one config field. `skillzkit config` shows all; `skillzkit config email new@x.com` updates that field.",
  )
  .option(
    "--show-secrets",
    "Reveal the encrypted-blob fields (the plaintext API key is never stored or shown)",
  )
  .action(
    (
      field: string | undefined,
      value: string | undefined,
      options: { showSecrets?: boolean },
    ) => runConfigCommand(field, value, options),
  );

cli
  .command(
    "contribute <path>",
    "Submit a new contribution. <path> is a .md file (command/workflow) or a directory containing SKILL.md (skill bundle). Requires team mode + a valid PIN.",
  )
  .option("--kind <kind>", "Override inferred kind: command | workflow | skill")
  .option("--slug <slug>", "Override inferred slug (e.g. core:tools:my-thing)")
  .option(
    "--bump <level>",
    "Version bump level: major | minor | patch (default: patch)",
  )
  .option("--changelog <message>", "Note describing this version's changes")
  .action(
    (
      path: string,
      options: {
        kind?: string;
        slug?: string;
        bump?: string;
        changelog?: string;
      },
    ) => runContributeCommand(path, options),
  );

cli.command("version", "Print the package version").action(() => runVersion());

cli
  .command(
    "tags",
    "List every tag in the catalog with usage counts, split into core (TAGS.md whitelist) and extension (free-form, candidates for promotion)",
  )
  .action(() => runTags());

cli.help();
cli.version("0.1.0");

cli.parse();
