# Phase F0 — Consumer migration checklist (READ-ONLY discovery)

**Branch:** `agent-adapter-prd-rebuild`. **Scope:** monorepo-wide. **No code changed by this pass.**

Discovery query:
`grep -rl "@helmsmith/agent-adapter" --include='*.ts' . | grep -v node_modules | grep -v '/agent-adapter-lib/'`
→ **23 files** match. **21 are real importers**; **2 are comment-only** (no `import` — `context-loader-core/src/catalog/index.ts` mentions the package in a docstring; `skillzkit/.../reviewer.ts` mentions it in a docstring AND re-declares a local OLD-shape `invoke` interface — a "shadow" consumer, no import).

## Surface delta (what changes under each consumer)
- **OLD** (`src/types.ts`, still exported from `index.ts`): `AgentAdapter { events: AdapterEventSource; invoke(spec: InvocationSpec): Promise<string> }`, `InvocationSpec { system?; user }`.
- **NEW** (`src/agent.ts` + `src/create-agent.ts`, NOT yet exported): `AgentAdapter { readonly type; readonly capabilities; readonly workdir; invoke(input: AgentInput, opts?): Promise<AgentInvocationResult>; stream(input, opts?): AsyncIterable<AgentChunk> }`; built via `createAgent({ spec, workdir, credentialBroker?, logger?, signal? })`.
- **Invoke call-shape migration:** `adapter.invoke({ system, user })` (returns a `string`) → build `AgentInput { messages: [{ role:'user', content:user }], systemPrompt:system }`, call `invoke(input)`, read `result.content`.
- **Events surface:** OLD `adapter.events` / `AdapterEventBus` / `AdapterEvent` / `AdapterEventSource` → replaced by `stream()` chunks (or the returned result). This is the deepest-coupled change (harness-core `job-bus`/orchestrator bridge).
- **Errors:** `AdapterError`/`AuthError`/`BillingError`/`RateLimitError`/`classifyHttpError` stay in `src/errors.ts` and **remain re-exported** by the new `index.ts` → STABLE, no consumer change (only verify they're still on the new barrel).

---

## Per-consumer table

| Package | File | What it imports / uses from `@helmsmith/agent-adapter` | Category | Migration action |
|---|---|---|---|---|
| **apps/pritty** | `src/ai.ts` (PROD) | `ClaudeSdkAdapter`, `CopilotChatAdapter`, `OpenAiChatAdapter` (direct `new`); `adapter.invoke({system,user})→string` (3 call sites: L189/272/372); own `EnvBroker.getCredential(p: Provider)` | direct-construct + OLD-invoke + broker | Replace 3 `new *Adapter` with `createAgent({ spec, workdir, credentialBroker })` (map `copilot`→`copilot-sdk`, `anthropic`→`claude-sdk`, `openai`→`openai-sdk`). Rewrite 3 invoke sites to `AgentInput`→`result.content`. **Broker-bridge** the `EnvBroker`. `ChatAdapter` union type (L33) → `AgentAdapter`. |
| **context/context-loader-core** | `src/catalog/index.ts` | docstring mention only (L246) — **NO import** | comment-only | None (vestigial doc; optionally reword). |
| **skillzkit/skillzkit** | `src/api/validation/reviewer.ts` | docstring (L7/65) + local `interface { invoke(spec:{system?;user}):Promise<string> }` (L71) — **NO import** | shadow OLD-invoke | Update the locally re-declared interface to the NEW `invoke(AgentInput)→AgentInvocationResult` shape if it is meant to accept platform adapters; else document the divergence. |
| **harness/harness-cli** | `src/steering-cli.test.ts` | `AdapterEventBus`, `AgentAdapter` (type), `InvocationSpec` | OLD type + events (test stub) | Rewrite the in-test stub adapter to the NEW `AgentAdapter` (`type`/`capabilities`/`workdir`/`invoke(AgentInput)`/`stream`); drop `events`/`AdapterEventBus`. |
| **harness/harness-core** | `src/orchestrator.ts` (PROD) | `AdapterError`, `AgentAdapter` (type), `BindingToAdapterOptions`, `bindingToAdapter`, `ClaudeSdkAdapter`, `OpenCodeCliAdapter`, `OpenCodeCliAdapterOptions`; `adapter.invoke({...})→string` (L954); `adapter.events`→`bridgeAdapter` (L952); also `Command` from `@langchain/langgraph` + `graph.invoke` | **everything**: direct-construct, bindingToAdapter, OLD-invoke, events, AgentAdapter type, LangGraph | The central migration. `defaultAdapterFactory` (L85) + `bindingToAdapterFn` path (L147, L353/389/1057/1071/1084) → `createAgent({spec, workdir, credentialBroker})`. `invoke({...})→string` → `AgentInput`→`result.content`. `adapter.events`→`bridgeAdapter` → consume `stream()`. `AdapterFactory`/`Map<string,AgentAdapter>` retype to NEW. `AdapterError` stays. **Broker-bridge** `deps.broker`. (LangGraph graph stays — F2 only moves `HarnessChatModel`/`LangGraphAdapter`, which this file does NOT import.) |
| **harness/harness-core** | `src/orchestrator.test.ts` | `AdapterEvent`, `AdapterEventBus`, `AgentAdapter`, `AuthError`, `BillingError`, `InvocationSpec`, `RateLimitError` | OLD type + events + errors (test) | Rewrite stub adapter to NEW; replace event assertions with stream/result assertions; error classes unchanged. |
| **harness/harness-core** | `src/job-bus.ts` (PROD) | `AdapterEvent`, `AdapterEventSource` (types) — `bridgeAdapter(bus, jobId, agentId, adapter.events)` | events surface | Re-model on NEW `stream()` chunks (`AgentChunk`) instead of `AdapterEvent`/`adapter.events`. Tightly coupled to orchestrator.ts L952. |
| **harness/harness-core** | `src/job-bus.test.ts` | `AdapterEvent`, `AdapterEventBus` | events (test) | Update to NEW chunk model. |
| **harness/harness-core** | `src/token-accumulator.test.ts` | `AdapterEvent` (type) | events (test) | Re-key token accounting off `AgentChunk`/`AgentInvocationResult.usage` (`TokenUsage`). |
| **harness/harness-pipeline-cli** | `src/index.ts` (PROD) | `AgentAdapter` (type), `BindingToAdapterOptions`, `bindingNeedsOpenCode`, `bindingToAdapter`, `defaultLocalEndpointResolver`, `OpenCodeServer`, `OpenCodeServerOptions`, `OpencodeProviderEntry`; `new SpecBroker(...)`→`bindingToAdapter({broker})` (L196/197, L232) | bindingToAdapter + OpenCodeServer (relocate) | `bindingToAdapter`→`createAgent`. `OpenCodeServer`/`OpencodeProviderEntry`/`OpenCodeServerOptions` are being relocated — repoint import to the new home. `bindingNeedsOpenCode`/`defaultLocalEndpointResolver` fold into spec construction. **Broker-bridge** `SpecBroker`. |
| **harness/harness-server** | `src/approval-resume-integration.test.ts` | `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` | OLD type + events (stub) | Rewrite stub adapter (`implements AgentAdapter` w/ `events`+`invoke→string`) to NEW interface. |
| **harness/harness-server** | `src/dispatcher-integration.test.ts` | `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` (`BlockingAdapter`/`PassthroughAdapter` stubs, L40/L75) | OLD type + events (stub) | Same — rewrite both stubs to NEW. |
| **harness/harness-server** | `src/file-routes-integration.test.ts` | `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` | OLD type + events (stub) | Same. |
| **harness/harness-server** | `src/orchestrator-integration.test.ts` | `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` | OLD type + events (stub) | Same. |
| **examples** | `01-host-only.ts` | `ClaudeSdkAdapter`, `FileEventSubscriber`; `new FileBroker`→adapter | direct-construct + capture + broker | `createAgent({spec:'claude-sdk'})`; `FileEventSubscriber`/capture → `opts.capture` / stream. **Broker-bridge** FileBroker. |
| **examples** | `02-opencode-host-only.ts` | `OpenCodeCliAdapter`, `FileEventSubscriber`; `new FileBroker`→adapter | direct-construct + capture + broker | `createAgent({spec:'opencode-cli'})`; capture as above. **Broker-bridge**. |
| **examples** | `11-orchestrated-pipeline-demo.ts` | `AdapterEvent`, `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` (+ `CredentialBroker` from agent-auth) | OLD type + events | Migrate stub/usage to NEW interface + stream. |
| **examples** | `12-in-process-cli-demo.ts` | `AdapterEventBus`, `AgentAdapter`, `InvocationSpec` | OLD type + events | Same. |
| **examples** | `13-per-worker-subscription-e2e.ts` | `bindingToAdapter`, `ClaudeSdkAdapter`, `OpenCodeCliAdapter`; `new FileBroker`→`bindingToAdapter({broker})` (5 sites) | bindingToAdapter + direct-construct + broker | `bindingToAdapter`/`new *Adapter`→`createAgent`. **Broker-bridge** FileBroker (5 call sites). |
| **examples** | `14-real-qwen-e2e.ts` | `bindingToAdapter`; `new FileBroker`→`bindingToAdapter` | bindingToAdapter + broker | `createAgent({spec:'opencode-cli', endpoint:…})`. **Broker-bridge**. |
| **examples** | `16-entry-coordinator-with-qwen.ts` | `bindingToAdapter`, **`createHarnessChatModel`** (F2); `new FileBroker` | bindingToAdapter + **LangGraph (F2)** | `bindingToAdapter`→`createAgent`; import `createHarnessChatModel` from the **new companion pkg**. **Broker-bridge**. |
| **examples** | `17-copilot-coordinator.ts` | **`createHarnessChatModel`** (F2) | **LangGraph (F2)** | Repoint `createHarnessChatModel` import to companion pkg. |
| **examples** | `18-coordinator-ab-providers.ts` | `CopilotChatAdapterOptions` (type), **`createHarnessChatModel`** (F2); `new FileBroker` (L168) | direct-adapter-type + **LangGraph (F2)** + broker | `createHarnessChatModel`→companion pkg; `CopilotChatAdapterOptions`→`CopilotSdkSpec`. **Broker-bridge**. |

### Per-package rollup (real importers = 21)
- apps/pritty: **1** (PROD)
- harness/harness-cli: **1** (test)
- harness/harness-core: **5** (2 PROD: `orchestrator.ts`, `job-bus.ts`; 3 test)
- harness/harness-pipeline-cli: **1** (PROD)
- harness/harness-server: **4** (all integration tests, stub adapters)
- examples: **9**
- comment-only (no import): context-loader-core **1**, skillzkit **1** (shadow OLD-invoke interface)

### OLD invoke-shape (`invoke({system,user})→Promise<string>` / `InvocationSpec`) consumers — **10 real + 1 shadow**
PROD: `apps/pritty/src/ai.ts`, `harness/harness-core/src/orchestrator.ts`.
Tests/demos importing `InvocationSpec`: `harness-cli/steering-cli.test.ts`, `harness-core/orchestrator.test.ts`, `harness-server/{approval-resume,dispatcher,file-routes,orchestrator}-integration.test.ts`, `examples/11`, `examples/12`.
Shadow (no import, local re-decl): `skillzkit/.../reviewer.ts`.

### Events surface (`AdapterEventBus`/`AdapterEvent`/`AdapterEventSource`/`adapter.events`) consumers
PROD: `harness-core/job-bus.ts` + `harness-core/orchestrator.ts` (the `bridgeAdapter` pair). Tests: `orchestrator.test.ts`, `job-bus.test.ts`, `token-accumulator.test.ts`, all 4 harness-server integration tests, `harness-cli/steering-cli.test.ts`, `examples/11`, `examples/12`.

### Integration-test note
harness-server's 4 integration tests + harness-cli + harness-core orchestrator.test all define **in-test stub adapters** (`class … implements AgentAdapter { events = new AdapterEventBus(); invoke(spec): Promise<string> }` — e.g. `BlockingAdapter`/`PassthroughAdapter`). They **do not construct real adapters** — they inject stubs. Migration = rewrite each stub to the NEW interface (add `type`/`capabilities`/`workdir`/`stream`, change `invoke` signature). harness-server has NO production importer of `@helmsmith/agent-adapter` (its coordinators take an injected `BaseChatModel`).

---

## F1 — deps-bump impact (`@anthropic-ai/sdk` 0.30→≥0.93, `zod` 3→^4)

**`@anthropic-ai/sdk` (biggest exposure — ALL in `core/agent-adapter-lib`):**
- `package.json`: dep + peerDep both pinned `^0.30.1` (L16/L22). The bump aligns with the `@anthropic-ai/claude-agent-sdk ^0.3.195` peer (L23/43), which requires anthropic-sdk ≥0.93.
- **Direct source call sites to fix (the API-shape risk):** `src/adapters/claude-sdk/index.ts`, `src/adapters/claude-sdk/normalize.ts`, `src/claude-sdk-adapter.ts` (OLD flat — being **deleted** in F3, so fix only if it must compile before deletion), `src/conformance.test.ts`, `src/conformance/fixtures/index.ts`.
- `apps/pritty/package.json` also declares `@anthropic-ai/sdk ^0.30.1` (L32) but **`src/ai.ts` has NO direct `@anthropic-ai/sdk` import** (it uses `ClaudeSdkAdapter`) → the dep is droppable; bump or remove, no call-site fix.

**`zod` (broader workspace, mostly OUTSIDE the adapter):**
- v3-pinned holdouts: `core/agent-adapter-lib` (`^3.25.32`, but **0 `from 'zod'` imports in its src** — near-zero exposure), `apps/pritty` (`^3.25.32`; `src/config.ts`), `apps/discord-timetracker` (`^3.25.32`; `src/config/{schema,load}.ts` — 2 files), `memory/edge-memory-server` (`^3.25.32`; `src/{schemas,openapi}.ts` + `openapi.test.ts` — **3 files, biggest `z.*` surface**).
- Already `^4` (no work): `apps/gitradar`, `apps/gittyup`, `apps/taskmaster`.
- **Biggest zod fallout risk:** `memory/edge-memory-server` (3 files, incl. OpenAPI schema gen) > `apps/discord-timetracker` (2) > `apps/pritty` (1). The adapter lib itself is low-risk for zod.

---

## F2 — LangGraph extrication scope

**Imports the agent-adapter↔LangChain bridge (`HarnessChatModel`/`createHarnessChatModel`/`LangGraphAdapter`) FROM `@helmsmith/agent-adapter` — these repoint to the new companion pkg:**
- `examples/16-entry-coordinator-with-qwen.ts` (`createHarnessChatModel`)
- `examples/17-copilot-coordinator.ts` (`createHarnessChatModel`)
- `examples/18-coordinator-ab-providers.ts` (`createHarnessChatModel`)
- **(No production package imports the bridge from agent-adapter.)**

**Broader `@langchain/*` footprint (deps that stay where they are; NOT agent-adapter imports):**
- `core/agent-adapter-lib/package.json`: `@langchain/core ^1.1.44`, `@langchain/langgraph ^1.3.0` → **REMOVE** after moving `harness-chat-model.ts` + `langgraph-adapter.ts` to the companion.
- `harness/harness-core`: `flow-graph.ts`, `orchestrator.ts` import `@langchain/langgraph` (`StateGraph`/`Command`) **directly** — own LangGraph consumer; deps stay.
- `harness/harness-server`: `coordinator/{entry,checkout}-coordinator.ts`, `index.ts`, `coordinator-auto-route.test.ts` import `@langchain/core` + `@langchain/langgraph` **directly** (injected `BaseChatModel`); deps stay.
- `apps/pritty/package.json`: declares `@langchain/core ^1.1.44` but **no source import** → vestigial, droppable.

**Companion package to create** (`@helmsmith/agent-adapter-langchain`): move `src/harness-chat-model.ts` (+`.test`) and `src/langgraph-adapter.ts` (+`.test`) out of agent-adapter-lib; carry the two `@langchain/*` deps.

---

## Broker-bridge call sites (`Provider`-typed broker → structural `CredentialBroker`)

The new `createAgent` takes `credentialBroker?: CredentialBroker` whose `getCredential(provider: string): Promise<{ apiKey: string; expiresAt?: Date }>`. Every consumer broker is `Provider`-typed and returns agent-auth's `Credential` (where **`expiresAt` is a `string`, NOT a `Date`**). So the bridge is **more than `as Provider`** — it must also normalize the return:
```ts
const bridged: CredentialBroker = {
  getCredential: async (p) => {
    const c = await fb.getCredential(p as Provider);   // Provider narrowing
    return { apiKey: c.apiKey, expiresAt: c.expiresAt ? new Date(c.expiresAt) : undefined };
  },
};
```
Brokers needing the bridge: agent-auth `FileBroker.getCredential(p: Provider)`; `harness-pipeline-cli` `SpecBroker implements CredentialBroker` (Provider); pritty's own `EnvBroker.getCredential(p: Provider)`.

**Call sites where a broker is handed to adapter construction (each becomes a `createAgent({credentialBroker})` site needing the bridge):**
- `harness/harness-core/src/orchestrator.ts` — **central PROD site**: `deps.broker: CredentialBroker` (agent-auth) → `defaultAdapterFactory` (L86/91 `new ClaudeSdkAdapter/OpenCodeCliAdapter({broker})`) + `bindingToAdapterFn` path (L353/389/1057/1071/1084, `build:` L1084).
- `harness/harness-pipeline-cli/src/index.ts` — `new SpecBroker(spec.bindings)` → `bindingToAdapter({broker})` (L197, L232).
- `apps/pritty/src/ai.ts` — `new EnvBroker(...)` → `new ClaudeSdkAdapter/OpenAiChatAdapter({broker})` (L70/71, L77/78) and `CopilotChatAdapter` (L63).
- `examples/01`, `examples/02` — `new FileBroker(authPath)` → adapter ctor.
- `examples/13` — `new FileBroker` → `bindingToAdapter({broker})` ×5.
- `examples/14`, `examples/16`, `examples/18` — `new FileBroker` → bindingToAdapter / coordinator wiring.

(A single shared helper, e.g. `bridgeBroker(fb)` exported from agent-auth or a small local util, is the cleanest fix for all sites.)

---

## Suggested F-execution order

1. **F1 deps-bump first** (isolated, unblocks live): bump `@anthropic-ai/sdk` 0.30→≥0.93 in `agent-adapter-lib` (+ drop/bump pritty's), fix the 5 claude-sdk/conformance call sites; bump `zod` 3→^4 across the 4 v3 holdouts (heaviest: edge-memory-server), fix `z.*` fallout. `pnpm -r typecheck && pnpm test` per bump, commit per bump.
2. **F2 LangGraph companion**: create `@helmsmith/agent-adapter-langchain`, move `harness-chat-model.ts`+`langgraph-adapter.ts` (+tests) + the `@langchain/*` deps; remove them from agent-adapter-lib; repoint examples 16/17/18; drop pritty's vestigial `@langchain/core`. Green.
3. **F3 the cut** (one coherent pass, branch tip ends green):
   a. Add a `bridgeBroker(Provider-broker)→CredentialBroker` helper (normalizes `expiresAt` string→Date).
   b. Flip `index.ts` to the NEW surface; keep `errors.*` re-exported; relocate `OpenCodeServer` to its new home (pipeline-cli's importer).
   c. Migrate the **events spine** together: `harness-core/job-bus.ts` + `orchestrator.ts` (`bridgeAdapter`→`stream()`), then their tests + `token-accumulator.test.ts`.
   d. Migrate `orchestrator.ts` adapter construction (`bindingToAdapter`/`defaultAdapterFactory`→`createAgent` + broker bridge) and `harness-pipeline-cli/index.ts` (+ `OpenCodeServer` repoint).
   e. Rewrite the in-test stub adapters (harness-server ×4, harness-cli, orchestrator.test) to the NEW interface.
   f. Migrate `apps/pritty/src/ai.ts` (createAgent + AgentInput + broker bridge); update `skillzkit/reviewer.ts` local interface.
   g. Migrate examples 01/02/11/12/13/14 (+16/18 broker parts).
   h. Delete OLD flat adapters (`claude-sdk-adapter.ts`, `opencode-cli-adapter.ts`, `copilot-chat-adapter.ts`, `openai-chat-adapter.ts`, `binding-to-adapter.ts`, OLD `types.ts`/`events.ts` content) + their tests.
4. **Verify whole monorepo:** `pnpm -r typecheck` (0 errors), `pnpm test` (green; confirm the pre-existing SQLite/gitradar failures are the same set, not new), `pnpm check` (biome), conformance suite green through the new `index.ts`.
