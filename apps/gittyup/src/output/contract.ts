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
