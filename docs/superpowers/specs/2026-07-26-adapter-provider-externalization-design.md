# agent-adapter: provider externalization

**Date:** 2026-07-26
**Status:** Approved design (pre-implementation)
**Owner:** Edwin Cruz
**Relates to:** the agent-node design, re-scoped and moved to
`smithagents/docs/superpowers/specs/2026-07-26-agent-node-swarm-hardening-design.md`
(node behavior lives in the smithagents fleet; this refactor is what enables
its future bridge adapter to register externally)

## Revision history

**2026-08-14** — amended after re-measuring the package against the source
tree and after a new requirement landed (adapter/model discovery). Nothing
had been implemented at the time of amendment: `AgentSpecRegistry` was
absent, the exports map had no subpaths, and `origin/feat/adapter-registry`
was empty relative to `main`. Changes:

- **§3.2** — registration changes from side-effect import to an exported
  `register*()` function per adapter. A bare side-effect import is silently
  defeated by `"sideEffects": false`, which §3.1 now sets.
- **§3.2** — subpath naming changes from provider shorthand (`./claude`,
  `./openai`) to `./adapters/<spec.type>`, so entries mirror `spec.type`
  1:1 and the §3.6 error message can derive the import path mechanically.
- **§3.2/§4** — the `./all` compat entry is dropped in favor of a hard
  cutover. `./all` would re-import all five optional SDKs, resurrecting the
  module-load crash this refactor exists to fix.
- **§3.4** — reversed: `CAPABILITY_MATRIX` is **retained** (renamed
  `ADAPTER_CATALOG`) rather than deleted, and sits alongside registry
  introspection as a second, distinct plane. Deleting it would leave the
  planned discovery/search feature able to search only what a host has
  already loaded, which is the opposite of what discovery means.
- **§3.5, §3.6** — new: registry idempotency, and the unregistered-type
  error message plus the `bindingToSpec` bedrock message it forces.

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

Measured 2026-08-14, to size the fix precisely:

- Exactly **three** adapters statically import an optional peer:
  `bedrock-sdk/index.ts:40`, `gemini-sdk/index.ts:21`, `openai-sdk/index.ts:21`.
  These are the module-load crashes.
- `claude-sdk/index.ts:20` statically imports `@anthropic-ai/sdk`, which is a
  non-optional **dependency** — so it always installs, for every host,
  regardless of which providers that host uses.
- `claude-agent-sdk/index.ts:171` already does this correctly:
  `await import('@anthropic-ai/claude-agent-sdk')` inside the call path, with
  `missing-package.test.ts` asserting the failure surfaces as `ConfigError`.
  It is the reference pattern, not an exception to make.
- `copilot-sdk` has **no** SDK dependency at all despite its name — it is
  `fetch` against `api.githubcopilot.com/chat/completions` with its own
  `sse-parser.ts`. It costs a host nothing today.
- Two of the three declared `dependencies` are vestigial:
  `@helmsmith/agent-auth` has no importer (`credentials/broker.ts:4-5`
  documents the structural copy that deliberately avoids it), and `zod` has
  no non-test importer.

## 2. Goals / non-goals

**Goals**

1. A host imports (and installs SDKs for) only the providers it uses.
2. External adapters register first-class — no casts. The first planned
   consumer is the smithagents fleet-bridge adapter (`'agent-node'`), which
   ships outside this lib entirely.
3. Existing consumers migrate by declaring their adapter set explicitly, one
   line per provider, at their composition root.
4. The set of *available* adapters stays queryable without loading any
   adapter or SDK — the seam the discovery/search work (§6) builds on.

**Non-goals**

- Package-per-provider split. Subpath entries make that a later mechanical
  move if a provider ever needs independent releases.
- Any behavior change inside individual adapters.
- Designing the discovery/search API itself, or the model catalog. Both are
  separate specs (§6); this one only guarantees the seam they need.

## 3. Design

### 3.1 Side-effect-free core

The root entry (`@helmsmith/agent-adapter`) stops importing the adapter
barrel; `src/index.ts:13` and `src/adapters/index.ts` are both deleted. Root
exports: core types, `createAgent`, registry, stream helpers, error taxonomy,
`intersectCapabilities`, and the static catalog (§3.4). Importing it
registers nothing and loads no provider SDKs.

Two consequences follow and are part of this change:

- The manifest declares `"sideEffects": false`. This is *true* only because
  §3.2 uses exported functions rather than import-time registration; the two
  decisions stand or fall together.
- `dependencies` becomes empty. `@helmsmith/agent-auth` and `zod` are removed
  as unused, and `@anthropic-ai/sdk` joins the other four as an optional
  peer, since after the barrel is gone it is reachable only through
  `./adapters/claude-sdk`. Installing this package pulls nothing.

### 3.2 Per-adapter subpath entries

Each adapter becomes a subpath export named for its `spec.type`:

| Entry | Registers |
|---|---|
| `./adapters/claude-sdk` | `claude-sdk` |
| `./adapters/claude-agent-sdk` | `claude-agent-sdk` |
| `./adapters/claude-code-cli` | `claude-code-cli` |
| `./adapters/opencode-cli` | `opencode-cli` (also exports `OpenCodeServer`) |
| `./adapters/codex-cli` | `codex-cli` |
| `./adapters/copilot-sdk` | `copilot-sdk` |
| `./adapters/copilot-cli` | `copilot-cli` |
| `./adapters/gemini-sdk` | `gemini-sdk` |
| `./adapters/gemini-cli` | `gemini-cli` |
| `./adapters/openai-sdk` | `openai-sdk` |
| `./adapters/bedrock-sdk` | `bedrock-sdk` |
| `./conformance` | (unchanged, already separate) |

Mirroring `spec.type` exactly — rather than provider shorthand — keeps one
name for one concept. It also removes an asymmetry the shorthand scheme
carried, where `./copilot` meant the SDK adapter but `./copilot-cli` meant
the CLI one, and it lets §3.6 derive an import path from a failed
`spec.type` with no lookup table.

There is **no `./all` entry**. It would import all five optional SDKs, which
is the module-load crash in §1 with a friendlier name.

Registration is an exported function, not an import-time side effect. Every
adapter module today ends in a bare top-level `registerAdapter(...)` call
(`codex-cli/index.ts:242`, `bedrock-sdk/index.ts:378`, and nine siblings);
each becomes:

```ts
export const codexCliFactory: AdapterFactory = (spec, deps) => { /* unchanged */ };
export const codexCliCapabilities = ADAPTER_CATALOG['codex-cli'].capabilities;

export function registerCodexCli(): void {
  registerAdapter('codex-cli', codexCliFactory, codexCliCapabilities);
}
```

Exporting the factory and capabilities alongside the registrar is deliberate
forward-compatibility: a future API that takes adapters explicitly
(`createAgent({ …, adapters: [codexCli] })`) becomes additive rather than a
second breaking change.

Each adapter entry also exports its spec type (`OpenAiSdkSpec` and siblings
move out of `agent.ts` into their adapter modules) and its capability
descriptor. `OpenCodeServer` moves to `./adapters/opencode-cli`; the root
re-export remains during migration with a deprecation note, because
`harness-pipeline-cli` imports it from root today.

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

### 3.4 Two capability planes

`CAPABILITY_MATRIX` is **retained**, renamed `ADAPTER_CATALOG`, and keyed by
`string` rather than by the (now open, now host-narrowed) `AgentSpecType`.
String keying is forced by §3.3: the catalog describes adapters whose modules
the host has deliberately *not* imported, so by construction their types are
not members of that host's `AgentSpecType`.

The two planes answer different questions and both are needed:

| Plane | Source | Answers | Costs |
|---|---|---|---|
| **Catalog** — `ADAPTER_CATALOG` | static table at root | "what adapters exist, and what can they do?" | nothing — no adapter module, no SDK |
| **Registry** — `listAdapterTypes()`, `getCapabilities()` | runtime registry | "what can *this host* do?" | only what the host registered |

The original §3.4 deleted the static table on the grounds that reading the
registry is more truthful. That is right for the host-introspection
question and is preserved above: `listAdapterTypes()` and `getCapabilities()`
now read the registry, not a source-tree constant. It is wrong for the
availability question. A broker choosing which three CLI adapters to adopt
must be able to ask "which adapters are CLI-transport with streaming and
autonomous tools?" *before* it registers anything; against a registry-only
API that query returns whatever it already loaded.

Ownership stays unambiguous rather than duplicated: `ADAPTER_CATALOG` is the
single source of truth for **built-in** capability descriptors, and each
built-in adapter passes `ADAPTER_CATALOG[type].capabilities` at registration
(the same indirection as today's `CAPABILITY_MATRIX[type]`). **External**
adapters are not in the catalog — they supply their descriptor at
registration and appear in registry introspection only. Catalog-vs-registry
drift is therefore structurally impossible for built-ins, and external
adapters are visible exactly where they should be.

Construction-time refinement (copilot-sdk's `supportsJsonMode`, resolved
against a known-models allowlist) is untouched and remains a registry-plane
fact.

A catalog entry is `{ type: string; capabilities: AdapterCapabilities }`, and
the `AdapterCapabilities` descriptor itself is unchanged from today. This
spec adds **no query API** over the catalog — `ADAPTER_CATALOG` is plain data
here. The dimensions discovery needs (transport, vendor) and the search
surface over them are §6 work.

### 3.5 Registry idempotency

`registerAdapter` currently warns and overwrites on any repeat registration
(`registry.ts:68-70`). Under §3.2 that fires spuriously whenever two packages
in one process want the same adapter — `pritty` imports `harness-core`, both
need `claude-sdk`. It becomes identity-aware:

```ts
const existing = _registry.get(type);
if (existing && existing.factory !== factory) {
  console.warn(`[agent-adapter/registry] overwriting existing factory for type '${type}'`);
}
```

Re-registering the same module's factory is a silent no-op; substituting a
different factory still warns, so the warning keeps its meaning for test
doubles and plugin replacement.

The rejected alternative — a module-level `registered` boolean inside each
`register*()` — is a trap: it would survive `_clearRegistry()`
(`registry.ts:93`), so any test that clears and re-registers would silently
run against an empty registry.

### 3.6 Failure messages

`create-agent.ts:104-110` currently references "Phases B–D′" and
self-registration, both of which this change makes false. Because §3.2 names
subpaths after `spec.type`, the replacement derives the fix mechanically and
reports what *is* registered:

```
No adapter factory registered for spec.type 'bedrock-sdk'.
Register it at your entry point:
  import { registerBedrockSdk } from '@helmsmith/agent-adapter/adapters/bedrock-sdk';
  registerBedrockSdk();
Currently registered: claude-sdk, opencode-cli
```

This is what converts the cost of explicit registration — a runtime failure
where there was previously an implicit success — into a self-fixing error.

One downstream message must change with it. `binding-to-spec.ts:207-213`
tells users to *"construct a `{ type: 'bedrock-sdk', model, region }` spec
directly."* Honoring that under explicit registration would require
`harness-core` to register `bedrock-sdk`, pulling `@aws-sdk` into
`harness-core` for every consumer — reintroducing the §1 problem one layer
up. **`harness-core` stays AWS-free**; the message instead names the
registration step the caller must perform:

```
bindingToSpec: bedrock bindings carry no AWS region. Register the adapter at
your entry point and construct the spec directly:
  import { registerBedrockSdk } from '@helmsmith/agent-adapter/adapters/bedrock-sdk';
  registerBedrockSdk();
  createAgent({ spec: { type: 'bedrock-sdk', model, region }, workdir });
Or remove bedrock:* entries from this agent's accepts list.
```

## 4. Migration

Hard cutover in one PR. The package is `private: true` with only
`workspace:*` consumers, so there is no external blast radius and no
deprecation obligation.

The rule for who registers: **composition roots register, libraries do not.**

| Package | Registers | Notes |
|---|---|---|
| `pritty` | `claude-sdk`, `copilot-sdk`, `openai-sdk` | app; the three types at `ai.ts:85,93,101` |
| `harness-core` | exports `registerBindingAdapters()` covering `claude-sdk`, `openai-sdk`, `copilot-sdk`, `opencode-cli` | exactly the set `binding-to-spec.ts` can emit; inventory lives beside the mapper that defines it. Deliberately excludes `bedrock-sdk` (§3.6) |
| `harness-pipeline-cli` | calls `registerBindingAdapters()` | app; reaches `createAgent` via `bindingToSpec` (`index.ts:203-211`) |
| `agent-adapter-langchain-lib` | nothing | library; its spec comes from its caller, so its caller registers. Documented in its README. Its `harness-chat-model.test.ts:26,36,128` is the only use of `CAPABILITY_MATRIX` outside the lib and follows the §3.4 rename |
| `context-loader-core` | — | declares the dependency but never imports it; drop the dependency |

Remaining `@helmsmith/agent-adapter` declarations that no source file imports
(`harness-server`, `harness-cli`, `taskmaster`, and the root manifest) are
audited in the same PR and dropped where genuinely unused; where they reach
the lib transitively through `harness-core`, they inherit its registration
and need no change.

Sequence within the PR:

1. Core changes: delete the barrel, add subpath entries, open the type
   registry (§3.3), rename and re-key the catalog (§3.4), idempotent
   registry (§3.5), new messages (§3.6), manifest cleanup (§3.1).
2. Convert all 11 adapter modules to exported `register*()`.
3. Migrate the four importing consumers per the table.
4. Type imports of provider specs (`OpenAiSdkSpec` from root) move to their
   adapter entries. `tsc` finds every site.
5. Remove the interim root `OpenCodeServer` re-export once
   `harness-pipeline-cli` imports it from `./adapters/opencode-cli`.

## 5. Testing

- **Zero-SDK smoke test:** the root entry imports and typechecks with no
  optional peer deps installed. The regression that matters most, and the
  test that would have caught the original bug.
- **Root registers nothing:** importing root leaves `registeredAdapterTypes()`
  empty. This inverts `index.test.ts:33` ("registers all 11 built-in adapters
  on import"), which becomes the primary assertion of the whole change.
- **Catalog survives independently:** `ADAPTER_CATALOG` has 11 entries and is
  searchable with zero adapters registered. Note that `index.test.ts:44`'s
  `listAdapterTypes()` assertion moves to the catalog, since under §3.4 that
  function now reports the (empty) registry at root.
- **Exports coverage, data-driven over the catalog:** every catalog entry has
  a matching `exports` key and a `register*()` that registers that exact
  type. Catches the twelfth adapter added later without an export entry.
- **Registry idempotency:** same factory twice is silent; a different factory
  for the same type warns (`registry.test.ts:112` splits into these two).
- **Type-level tests:** `@ts-expect-error` that an unimported provider's spec
  type is unusable; augmentation from a second module widens the union.
- Per-adapter tests, fixtures, and the conformance suite are unchanged — the
  conformance entry point never touches the registry.

## 6. Sequencing

This refactor stands alone and is worth landing on its own merits (it removes
the forced-provider tax for every host). It is also a prerequisite for two
separate efforts:

1. **The smithagents fleet-bridge adapter** (that spec's §6), which will
   augment `AgentSpecRegistry` from outside this lib when a helmsmith flow
   first needs a fleet worker.
2. **Adapter and model discovery**, specified separately and split in two:
   - *Adapter discovery* — add `transport` (`cli` | `sdk`) and `vendor`
     dimensions to `ADAPTER_CATALOG` entries and a real query API over them.
     Today those facts exist only inside the type *string* (`'gemini-cli'`),
     parsed by suffix rather than stored as data, and `listAdapterTypes`'
     exact-match AND-only filter is too weak to build on.
   - *Model discovery* — vision, context window, modalities. Most of the data
     already exists as `ModelDescriptor` / `LLMProvider` /
     `BUILT_IN_PROVIDERS` in `@helmsmith/agent-auth` (`llm-provider.ts`), so
     that work is a join and a surface, not a new catalog. It must first
     settle whether `agent-adapter` takes a real dependency on `agent-auth`,
     which would reverse the decoupling `credentials/broker.ts:4-5`
     deliberately established.

   Both depend on §3.1 and §3.4: discovery is only meaningful if the catalog
   can be searched without loading the adapters it describes.
