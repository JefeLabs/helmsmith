# @ecruz165/cli-kit

Shared CLI bootstrap for the AgentX ecosystem. Consumed by every
toolbox app (skillzkit, toolz, gitradar, pritty, taskmaster) and by
platform CLIs (workspace-cli, harness-cli, harness-pipeline-cli,
context-loader-cli, edge-context-cli, edge-memory-cli) — 11 CLIs in
total.

**Runtime-agnostic.** Works on Node and Bun. No Bun-specific imports
so it doesn't constrain consumers' runtime choice.

## Install

```bash
npm install @ecruz165/cli-kit commander inquirer
```

`commander` and `inquirer` are peer dependencies — each consumer pins
its own version (or inherits from the toolbox root `overrides`).

## Usage

```ts
import { createCli } from "@ecruz165/cli-kit";
import { input } from "@inquirer/prompts";
import { agentAuthProvider } from "./auth.js"; // your auth wiring

const { program, auth } = createCli({
  name: "pritty",
  version: "0.1.0",
  description: "AI-powered commit and PR CLI",
  auth: agentAuthProvider,
});

program
  .command("commit")
  .option("-m, --message <msg>", "commit message")
  .action(async (opts) => {
    const token = await auth.getToken();
    const message = opts.message ?? (await input({ message: "Commit message:" }));
    // ... do the work
  });

program.parse();
```

## Why pluggable auth?

cli-kit is consumed by both toolbox apps (which use
`@ecruz165/agent-auth`) and platform CLIs (which may use different
auth flows). Hardcoding agent-auth would force every consumer onto it.

The `AuthProvider` interface is intentionally minimal:

```ts
interface AuthProvider {
  getToken(): Promise<string>;
  whoami?(): Promise<{ id: string; email?: string; name?: string } | null>;
}
```

Login flows, token storage, and refresh policy belong in the auth
library itself — not here. cli-kit just needs to know how to ask for
a token.

## What this package does NOT do

- **Subcommand registration patterns**: each app owns its
  `src/commands/` structure. cli-kit gives you a configured `program`;
  what you register on it is your call.
- **Logging / colors**: use `chalk` directly. cli-kit doesn't wrap it.
- **TUI**: use `@opentui/core` / `@opentui/react` directly inside the
  command's action handler. cli-kit doesn't try to abstract TUI.
- **Login flows**: live in `@ecruz165/agent-auth` (or whichever auth
  library you're wiring).

## Versioning

This package follows semver. Breaking changes to `AuthProvider` or
`CreateCliOptions` are major-version bumps. Adding optional fields is
a minor.
