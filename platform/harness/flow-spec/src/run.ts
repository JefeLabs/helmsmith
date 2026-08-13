/**
 * `@helmsmith/flow-spec/run` — the RUN-SIDE wire shapes: what a
 * reviewer UI, job dashboard, or worker-fleet consumer binds against
 * while jobs execute. Pairs with `./definition` (authoring surface)
 * and `./tenancy` (product/git shapes); the root entry (`.`) remains
 * the full union.
 */
export { type FlowOutputParseResult, parseFlowOutput } from './output.ts';
export type {
  ApprovalClaim,
  ApprovalRequest,
  ApprovalResume,
  ChangedFile,
  FlowRunState,
  JobIntent,
  NodeExit,
  RejectionPayload,
  SuspendRequest,
} from './types.ts';
