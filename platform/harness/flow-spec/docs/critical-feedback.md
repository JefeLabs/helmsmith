# Flow Spec — Critical Feedback (Consolidated, Current)

**Date:** 2026-08-07 · Companion docs: [`SPEC.md`](../SPEC.md) · [`steps-and-edges.md`](./steps-and-edges.md) · [`next-steps.md`](./next-steps.md)

One document, every open criticism, with status. Sources: the pre-extraction design review (`docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`), the package-level critique from `SPEC.md` §7, and the semantic findings from documentation-as-audit. Items already fixed are listed once in §1 and not re-argued.

**Severity:** 🔴 can silently produce wrong behavior · 🟡 design debt that compounds · 🔵 polish / future-proofing

---

## 1. Resolved — for the record

| Finding | Resolution |
|---|---|
| Canonical spec was a dangling pointer (`.plans/flow-designer-spec-v1.0.md`) | Spec now lives as code in `@helmsmith/flow-spec`; stale references fixed |
| Dead config accepted silently (`policy`, `joinStrategy`, `terminal:'fail'`, non-manual triggers, `js`, fan-out) | `onUnsupported` seam + one `console.warn` line per finding in `loadCatalog` |
| `pipelines.json` / `flows.json` doc drift | Fixed in catalog.ts header |
| Evaluator locked to LangGraph's `FlowStateT` | Retyped to structural `unknown`; browser consumers can share it |
| Expression semantics undocumented/unpinned (dot-numeric array indexing, SameValueZero `in`, reference-equality `==`) | Documented + pinned: 17 fixtures (JSON-serializability guarded) + NaN code-level test; runtime replays fixtures in `flow-spec-conformance.test.ts` |
| No compatibility proof for the extraction | Baseline 216 → 230 tests verified via stash comparison; 211 external-consumer tests untouched |

## 2. Open — package-level (this package's debt)

### 🟡 The export surface is unguarded
`index.ts` wildcard-exports four modules, and harness-core's `catalog.ts` wildcard-exports the package again. Any new symbol becomes public API of two packages with no review point. Cheapest high-leverage fix in the package: curated named exports at both layers.

### 🟡 `AdapterId` bakes two runtime implementations into the wire contract
`'claude-sdk' | 'opencode-cli'` is a closed union in the *spec* package — adding an adapter is a spec change. Everything else in the contract references by id and resolves at runtime (`toolId`, `flowId`); adapters should work the same way (`string` + registry check).

### 🟡 It's a catalog-spec wearing a flow-spec name
`ProductDef`, `ProductRepo`, `ContextSourceDef` (tenancy/git shapes) live here because `validateUnifiedCatalog` needs them. Defensible — but a designer UI importing flow types drags in clone-URL shapes. Rename or split when the designer becomes real.

### 🟡 Runtime seams migrated with the types
`ToolResolver` (`(toolId) => ToolDef | undefined`) is a dispatch signature, not a wire shape — it can't be stored or rendered. Softer versions of the same question: `walkAgents`, `resolveAccepts`. They rode along in the verbatim move; the export-surface curation (above) is the natural moment to decide their home.

### 🔴 The `onUnsupported` list runs on convention
Nothing ties the report list to what the runtime executes. The README rule ("delete the report in the change that implements the feature") is unenforced — implement `policy.retry` tomorrow and forget the deletion, and every catalog using it warns falsely forever (or worse: the inverse, a new dead field never gets a report). Fix: unsupported-feature fixtures `(flow, expectedFeatures)` replayed by harness-core, like the expression fixtures already are.

### 🟡 Conformance covers one of three behaviors
Expressions have replayable fixtures; **validation verdicts** (valid/invalid catalogs + expected error substrings) and **warning expectations** do not — they're locked in `validate.test.ts` as code, which a Java validator or designer can't replay. The package defines three behaviors; it publishes conformance data for one.

### 🟡 No schema artifact
Controlplane still stores opaque JSONB; Phase 2 would hand-port these rules into Java, and the smithagents seam wants a language-neutral contract. Generated JSON Schema from these types is the agreed answer and doesn't exist yet.

### 🔵 `scanForJsExpressions` can false-positive on inert data
A `literal` whose `value` contains `{kind:'js', expression:'…'}` is reported as a js expression though it's never evaluated. Warning-only today; walking known expression positions (edge conditions, assertions, transform expressions, loop paths, matchers, tool args) would be precise.

### 🔵 Packaging hygiene
No `test` script (`pnpm -r test` skips the contract's own tests); version 0.0.0/private with no changeset wiring despite semver being a stated extraction motive. Both fine today, both wrong the day the first out-of-repo consumer appears.

## 3. Open — runtime-level (harness-core's debt, visible through the spec)

These are inherited from the original review; the spec now *warns* about the first row's class, but nothing here executes yet.

| Gap | Severity | Current truth |
|---|---|---|
| `policy` retry/timeout/onError, `joinStrategy`, `terminal:'fail'` | 🔴 | Warned at load, ignored at runtime — authors' reliability config does nothing |
| Parallel fan-out/join | 🔴 | Router follows first sequence edge only; reducers and `joinStrategy` imply otherwise; second+ branches never run (warned) |
| Non-manual triggers | 🟡 | Validated cron/webhook/event/message shapes with no ingress, scheduler, or subscription behind them (warned) |
| Output contracts | 🔴 | `job-intent` — the factory/fleet seam — has types and a static check, zero runtime parsing/emission. `structured.schema` never validates anything |
| Approval `slaMs` / `assigneeRole` | 🔴 | No auto-reject timer; resume route checks only job status — any caller with socket access can approve |
| Durability | 🔴 | `MemorySaver` default checkpointer: restart loses every awaiting-approval/suspended job; durable savers supported but never wired |
| Suspend wake-ups | 🟡 | No timer/event scheduler; resume is entirely the caller's job |
| Loop state semantics | 🟡 | Only last iteration's non-output delta survives; chunked parallelism; no sibling cancellation |
| Subflow v1-light | 🟡 | No agents or interrupt tags inside subflows (compile-time ban — honest, but limits composition) |
| Synthetic interrupt nodes typed as `kind:'agent'` | 🔵 | Type-system lie with cast placeholder configs; future walkers over rewritten flows will trip |
| `changedFiles` only grows | 🔵 | Reverted files stay in the reviewer's diff surface (documented as intentional; still surprising) |
| Legacy coordinator filter | 🔵 | `linearFlowFromAgents` hardcodes skipping ids `coordinator`/`checkout-coordinator` |

## 4. The one-sentence summary

The extraction fixed the *honesty* problem — the spec now tells you what it won't do — but the *capability* gap is unchanged: the runtime executes a clean, well-tested subset of a contract that still promises more, and the mechanisms keeping spec and runtime aligned (the warning list, the fixture discipline) are only as strong as the conventions §2 asks to turn into tests.
