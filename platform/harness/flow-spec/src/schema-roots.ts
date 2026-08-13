/**
 * BUILD-ONLY roots for the generated JSON Schema artifact (roadmap 1.2).
 *
 * `pnpm schema` (ts-json-schema-generator, a devDependency — the
 * runtime stays zero-dep) generates `schema/flow-spec.schema.json`
 * from this interface: one named root per wire shape a non-TypeScript
 * consumer needs — controlplane's Phase 2 write-time validation (Java)
 * and the smithagents work-order seam (JobIntent) — with every
 * referenced type emitted as a $ref'd definition.
 *
 * This module is deliberately NOT exported from index.ts: it exists
 * only as generator input. `schema-artifact.test.ts` regenerates and
 * compares against the checked-in file, so a type change that forgets
 * to re-run `pnpm schema` fails CI — the artifact cannot drift from
 * the types.
 */
import type {
  ApprovalClaim,
  ApprovalRequest,
  ApprovalResume,
  Catalog,
  ChangedFile,
  FlowDef,
  FlowRunState,
  JobIntent,
  NodeExit,
  SuspendRequest,
} from './types.ts';

export interface FlowSpecSchemaRoots {
  /** The storage/validation shape (flows + products). */
  catalog: Catalog;
  /** A single flow definition. */
  flow: FlowDef;
  /** The factory/fleet work order. */
  jobIntent: JobIntent;
  /** The run-state surface expressions bind against. */
  runState: FlowRunState;
  /** HITL payloads a reviewer UI exchanges with the runtime. */
  approvalRequest: ApprovalRequest;
  approvalClaim: ApprovalClaim;
  approvalResume: ApprovalResume;
  suspendRequest: SuspendRequest;
  /** Routing exit signal + reviewer file surface. */
  nodeExit: NodeExit;
  changedFile: ChangedFile;
}
