# agent-adapter: provider externalization

**Date:** 2026-07-26
**Status:** Approved design (pre-implementation)
**Owner:** Edwin Cruz
**Relates to:** `2026-07-26-agent-node-design.md` (amends its §3 placement)

## 1. Problem

Adopting `@helmsmith/agent-adapter` forces a hosting application to carry
every provider:

- The root barrel imports `src/adapters/index.ts` **for side effects**,
  executing all 11 adapter modules on any import of the lib.
- SDK adapters use **top-level static imports** of their SDKs (e.g.
  `openai-sdk/index.ts` line 21: `import OpenAI from 'openai'`). The peer
  deps are marked optional, but a host without `openai` installed crashes at
  module load. "Optional" is only true on paper.
- `AgentSpecType` / `AgentSpec` are **closed unions** and the registry is
  keyed by them, so external adapters cannot register without casts.
  Evidence of the cost: `agent-adapter-langchain-lib` opens with "this is
  NOT a platform `AgentAdapter`" — it bypassed the contract rather than
  extend it.

## 2. Goals / non-goals

**Goals**

1. A host imports (and installs SDKs for) only the providers it uses.
2. Third-party adapters register first-class — no casts. The agent-node
   adapter ships with the agent-node packages, not in this lib.
3. Existing consumers migrate with one line per provider (or one compat
   import).

**Non-goals**

- Package-per-provider split (Approach B). Subpath entries make that a later
  mechanical move if a provider ever needs independent releases.
- Any behavior change inside individual adapters.

## 3. Design

### 3.1 Side-effect-free core

The root entry (`@helmsmith/agent-adapter`) stops importing the adapter
barrel. It exports: core types, `createAgent`, registry, stream helpers,
error taxonomy, `intersectCapabilities`. Importing it registers nothing and
loads no provider SDKs. A "core imports cleanly with zero optional SDKs
installed" test locks this in.

### 3.2 Per-provider subpath entries

Each provider becomes a subpath export whose import self-registers exactly
one adapter:

| Entry | Registers |
|---|---|
| `./claude` | `claude-sdk` |
| `./claude-agent` | `claude-agent-sdk` |
| `./claude-code` | `claude-code-cli` |
| `./opencode` | `opencode-cli` (also exports `OpenCodeServer`) |
| `./codex` | `codex-cli` |
| `./copilot` | `copilot-sdk` |
| `./copilot-cli` | `copilot-cli` |
| `./gemini` | `gemini-sdk` |
| `./gemini-cli` | `gemini-cli` |
| `./openai` | `openai-sdk` |
| `./bedrock` | `bedrock-sdk` |
| `./all` | all 11 — compat entry reproducing today's behavior |
| `./conformance` | (unchanged, already separate) |

Each provider entry also exports its spec type (`OpenAiSdkSpec` moves out of
`agent.ts` into its adapter module) and its capability descriptor.
`OpenCodeServer` moves to `./opencode`; the root re-export remains during
migration with a deprecation note (harness-pipeline-cli imports it today).

### 3.3 Open type registry (declaration merging)

```ts
// core agent.ts
export interface AgentSpecRegistry {}                 // providers augment this
export type AgentSpecType = keyof AgentSpecRegistry & string;
export type AgentSpec = AgentSpecRegistry[AgentSpecType];

// in each provider module
declare module '../agent.ts' {
  interface AgentSpecRegistry { 'openai-sdk': OpenAiSdkSpec }
}
```

The host's type universe mirrors its runtime registry: import two providers
and `AgentSpecType` has exactly two members; import none and it is `never`.
You cannot construct a spec for a provider whose module you never imported.
External packages (agent-node) augment the same interface from outside the
lib. The registry map is keyed by `string` internally; `registerAdapter` /
`getAdapterFactory` / `createAgent` stay typed against `AgentSpecType`.

### 3.4 Capabilities become registration-carried

`CAPABILITY_MATRIX` (a `Record` over the closed union) is deleted. The
registry already stores capabilities per entry (`registerAdapter(type,
factory, capabilities)`); each provider module owns its descriptor and
passes it at registration. `listAdapterTypes(filter)` and a new
`getCapabilities(type)` read the runtime registry — which is more truthful:
they answer "what can *this host* do," not "what exists in the source tree."
Construction-time refinement (copilot-sdk's `supportsJsonMode`) is untouched.

## 4. Migration

1. Land core changes + subpath entries + `./all` in one PR. `./all` keeps
   every existing consumer working with a single import-path change if any.
2. Consumers whose `spec.type` comes from **static code** add one subpath
   import per provider used. Consumers that resolve `spec.type` from
   **runtime config** (harness-server's catalog) either import `./all` or
   import the provider set their deployment enables — their choice, now.
3. Type imports of provider specs (`OpenAiSdkSpec` from root) update to the
   provider entry. `tsc` finds every site.
4. After consumers migrate, root `OpenCodeServer` re-export and any interim
   shims are removed. `./all` stays — it is legitimate, not just compat.

## 5. Testing

- **Zero-SDK smoke test:** core entry imports and typechecks with no
  optional peer deps installed (the regression that matters most).
- **Type-level tests:** `@ts-expect-error` that an unimported provider's
  spec type is unusable; augmentation from a second module widens the union.
- **Registry tests:** updated for string-keyed internals; per-adapter tests
  and fixtures unchanged; conformance suite unchanged.

## 6. Sequencing

This refactor lands **before** agent-node v1. Agent-node's adapter and
protocol schemas then ship inside the agent-node packages (amended in the
agent-node spec §3), augmenting `AgentSpecRegistry` from there — the lib is
not touched by agent-node at all.
