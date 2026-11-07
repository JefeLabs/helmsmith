/**
 * The `--json` documents — the contract a caller (workbrokr, an agent) parses.
 * Shapes follow spec docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §4.
 * While gittyup is 0.x a shape may change when a hardening slice lands; each
 * such change is listed in the CHANGELOG under "JSON contract" (spec §3.6).
 */
import type { RepoConfig } from '../config/schema.js';

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
