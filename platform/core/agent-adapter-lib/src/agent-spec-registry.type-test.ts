/**
 * Compile-time assertions for the open adapter-type registry.
 *
 * Plain .ts, not a vitest file: `tsc --noEmit` is the assertion runner. If any
 * `Assert<...>` below is not `true`, typecheck fails.
 *
 * What is NOT asserted here, deliberately: that an UNIMPORTED adapter is absent
 * from AgentSpecType. TypeScript applies module augmentations per PROGRAM, not
 * per import — every adapter file in this package is in this program, so all 11
 * contribute here regardless of imports. The narrowing is real only across
 * program boundaries (a consuming package whose tsconfig never pulls in an
 * adapter file). Asserting it here would assert something false.
 */

import type { AgentSpec, AgentSpecRegistry, AgentSpecType, BaseSpec } from './agent.ts';

type Assert<T extends true> = T;
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

// ---------------------------------------------------------------------------
// Augmentation contributes types
// ---------------------------------------------------------------------------

export type AugmentedTypesAreMembers = Assert<
  'codex-cli' extends AgentSpecType ? ('bedrock-sdk' extends AgentSpecType ? true : false) : false
>;

/** All 11 built-ins augment the registry, so the union is not `string` here. */
export type RegistryIsPopulated = Assert<Equals<AgentSpecType, string> extends true ? false : true>;

/** AgentSpec resolves to the augmented spec shape, not a bare BaseSpec. */
export type SpecCarriesProviderFields = Assert<
  AgentSpecRegistry['codex-cli'] extends AgentSpec ? true : false
>;

// ---------------------------------------------------------------------------
// The empty-registry fallback
// ---------------------------------------------------------------------------
//
// Replicated locally because this package's own registry is never empty. This
// is the case that keeps type-only consumers compiling: harness-server has
// `class TestAdapter implements AgentAdapter`, and AgentAdapter.type resolving
// to `never` would make it unimplementable.

type EmptyRegistry = {};
type EmptyKeys = keyof EmptyRegistry & string;
type FallbackType = [EmptyKeys] extends [never] ? string : EmptyKeys;
type FallbackSpec = [EmptyKeys] extends [never] ? BaseSpec & { type: string } : never;

export type EmptyRegistryFallsBackToString = Assert<Equals<FallbackType, string>>;
export type EmptyRegistrySpecIsUsable = Assert<
  { model: string; type: 'anything' } extends FallbackSpec ? true : false
>;

/** Without the fallback this would be `never` — the bug the fallback prevents. */
export type WithoutFallbackWouldBeNever = Assert<Equals<EmptyKeys, never>>;
