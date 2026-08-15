# @helmsmith/flow-spec

## 0.2.0

### Minor Changes

- e1987d5: Add `AgentDef.bootstrap`: ordered argv commands run before a CLI-backed agent's first turn.

  A flow previously had nowhere to say "this agent needs a Copilot plugin installed", so a catalog only ran correctly in a workspace someone had prepared by hand:

  ```json
  "bootstrap": [
    { "run": ["copilot", "plugin", "marketplace", "add", "obra/superpowers-marketplace"] },
    { "run": ["copilot", "plugin", "install", "superpowers@superpowers-marketplace"] }
  ]
  ```

  Steps run on **every** spawn. That is deliberate — preparing a workspace once makes a flow depend on state it does not declare, so the same catalog succeeds in one workspace and fails in a fresh one. Each step must therefore be idempotent, and a non-zero exit fails the spawn rather than letting the agent discover the gap later.

  `run` is argv executed **without a shell**, so a catalog cannot become an injection vector by being opened or run. Shell metacharacters are accepted and inert: with no shell, filtering them would break legitimate arguments (a glob passed to a tool that expands it itself) while adding no safety. A conformance fixture pins that, because a second implementation could otherwise reasonably assume it should reject `;` as hardening.

  The validator rejects `bootstrap` on adapters that are not CLI-backed, deciding by the `-cli` suffix every registered CLI adapter already follows (`claude-code-cli`, `codex-cli`, `copilot-cli`, `gemini-cli`, `opencode-cli`) and which `claude-sdk` does not. New `ValidateOptions.cliAdapters` replaces that rule for an adapter which breaks the convention, so a conforming new adapter needs no flow-spec release.

  `BootstrapStep` is exported from both the root entry and `./definition` — the authoring surface a designer UI imports.

## 0.1.1

### Patch Changes

- Ship the regenerated JSON Schema artifact.

  `schema/flow-spec.schema.json` is exported as the `./schema` subpath, so it is
  part of the published surface. The copy in 0.1.0 predates the regeneration that
  landed with the control-plane `/v1/catalog` wire contract: 1921 lines then, 1653
  now. The definition set is byte-for-byte equivalent in scope — all 48 `$defs`
  present in both, none added, none removed — so this is a compaction of the
  emitted artifact rather than a change in what the schema accepts.

  No change to `src/`, so the emitted `dist/` is identical to 0.1.0.
