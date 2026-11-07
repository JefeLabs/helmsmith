/**
 * The `--json` documents — the contract a caller (workbrokr, an agent) parses.
 * Shapes follow spec docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §4.
 * While gittyup is 0.x a shape may change when a hardening slice lands; each
 * such change is listed in the CHANGELOG under "JSON contract" (spec §3.6).
 */

// ─── cache ─────────────────────────────────────────────────────────

export interface CacheClearDocument {
  cleared: number;
}

export interface CachePruneDocument {
  pruned: number;
}
