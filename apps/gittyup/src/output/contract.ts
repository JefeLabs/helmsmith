/**
 * The `--json` documents — the contract a caller (workbrokr, an agent) parses.
 * Shapes follow spec docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §4.
 * While gittyup is 0.x a shape may change when a hardening slice lands; each
 * such change is listed in the CHANGELOG under "JSON contract" (spec §3.6).
 */
import { existsSync } from 'node:fs';
import type { ManifestManager } from '../config/manifest.js';
import type { AiMode, RepoConfig } from '../config/schema.js';

// ─── shared ────────────────────────────────────────────────────────

export interface ManifestRef {
  path: string;
  exists: boolean;
}

export function manifestRef(m: ManifestManager): ManifestRef {
  return { path: m.manifestPath, exists: existsSync(m.manifestPath) };
}

// ─── cache ─────────────────────────────────────────────────────────

export interface CacheClearDocument {
  cleared: number;
}

export interface CachePruneDocument {
  pruned: number;
}

// ─── manifest: groups and repos ────────────────────────────────────

export interface RepoDocument {
  name: string;
  path: string;
  remote: string;
  url: string | null;
  branches: Record<string, string>;
  tags: string[];
}

export function toRepoDocument(repo: RepoConfig): RepoDocument {
  return {
    name: repo.name,
    path: repo.path,
    remote: repo.remote,
    url: repo.url ?? null,
    branches: repo.branches,
    tags: repo.tags,
  };
}

export interface GroupCreateDocument {
  created: { group: string; description: string | null };
}

export interface GroupRemoveDocument {
  removed: { group: string };
}

export interface RepoAddDocument {
  added: { group: string; groupCreated: boolean; repo: RepoDocument };
}

export interface RepoRemoveDocument {
  removed: { group: string; repo: string };
}

export interface RepoListDocument {
  manifest: ManifestRef;
  groups: Array<{ name: string; description: string | null; repos: RepoDocument[] }>;
}

export interface RepoTagsDocument {
  tags: Array<{ tag: string; repos: number }>;
}

export interface RepoTagDocument {
  updated: Array<{ repo: string; tags: string[] }>;
  added: string[];
  removed: string[];
}

// ─── config and auth ───────────────────────────────────────────────

export interface TokenRow {
  available: boolean;
  source: string | null;
}

export interface ConfigDocument {
  manifest: { path: string; location: 'home' | 'repo' };
  settings: {
    aiMode: AiMode;
    aiModel: string;
    aiModelIsDefault: boolean;
    conflictBranchPrefix: string;
  };
  agent: TokenRow;
  github: TokenRow;
}

export interface AuthStatusDocument {
  agent: TokenRow & { reachable: boolean | null };
  github: TokenRow;
}

export interface AuthModelsDocument {
  models: Array<{ id: string; maxPromptTokens: number | null; maxOutputTokens: number | null }>;
}

// ─── status ────────────────────────────────────────────────────────

export interface StatusBranchDocument {
  branch: string;
  trackingBranch: string | null;
  tracking: boolean;
  ahead: number | null;
  behind: number | null;
  /** `null` when the branch could not be read (see `error`). */
  isDirty: boolean | null;
  /** `null` when the branch could not be read (see `error`). */
  hasConflicts: boolean | null;
  lastCommit: { sha: string; date: string } | null;
  /** Why the branch could not be read, e.g. it doesn't exist in this repo. */
  error?: string;
}

export interface StatusRepoDocument {
  name: string;
  group: string;
  path: string;
  currentBranch: string | null;
  hasUnresolved: boolean;
  error?: string;
  branches: Record<string, StatusBranchDocument>;
}

export interface FetchRow {
  repo: string;
  ok: boolean;
  error?: string;
}

export function toFetchRows(
  results: Array<{ repo: string; success: boolean; error?: string }>,
): FetchRow[] {
  return results.map((r) =>
    r.success ? { repo: r.repo, ok: true } : { repo: r.repo, ok: false, error: r.error },
  );
}

export interface StatusDocument {
  generatedAt: string;
  manifest: ManifestRef;
  fetch: FetchRow[] | null;
  repos: StatusRepoDocument[];
  summary: { repos: number; withConflicts: number; withErrors: number };
}

// ─── compare ───────────────────────────────────────────────────────

export interface CompareSideDocument {
  /** ISO-8601. */
  lastCommitDate: string;
  author: string;
  sinceDays: number;
  /** Commits reachable from the branch (whole history, capped at 9999). Hardening §3.9's
   *  "only on this side" counts will arrive as new fields. */
  commitCount: number;
}

export interface CompareRepoDocument {
  name: string;
  group: string;
  url: string | null;
  leftRef: string;
  rightRef: string;
  /** `null` when the check did not run: `--no-conflicts`, a side missing, or `error`. */
  hasConflicts: boolean | null;
  left: CompareSideDocument | null;
  right: CompareSideDocument | null;
  pr: { number: number; state: 'open' | 'closed' | 'merged'; url: string; date?: string } | null;
  /** This repo's PR lookup failed; `pr: null` then means unknown, not "no open PR". */
  prError?: string;
  error?: string;
}

export interface CompareDocument {
  left: string;
  right: string;
  cache: { hit: boolean; ageMs: number | null };
  repos: CompareRepoDocument[];
  prLookup: { ran: boolean; error?: string };
  summary: { repos: number; withConflicts: number; clean: number };
}

// ─── prs, fetch, find ──────────────────────────────────────────────

export interface PrsDocument {
  repos: Array<{
    name: string;
    prs: Array<{ number: number; title: string; head: string; base: string; url: string }>;
    error?: string;
  }>;
}

export interface FetchDocument {
  repos: FetchRow[];
}

export interface FindDocument {
  root: string;
  repos: Array<{
    name: string;
    absolutePath: string;
    relativePath: string;
    remoteUrl: string | null;
    currentBranch: string | null;
    isDirty: boolean | null;
  }>;
}
