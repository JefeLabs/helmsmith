# AgentX Taskmaster — Executive Overview

**Version:** 0.1.0 | **Status:** Active Development | **License:** MIT

---

## What It Is

AgentX Taskmaster is a command-line tool that converts implementation plans into structured, prioritized task hierarchies — automatically scoring complexity, breaking down large work items, and surfacing what's ready to be worked on next.

It is the engine that powers intelligent task delegation for AI agent teams.

---

## The Problem

When teams — human or AI — tackle a large implementation plan, the same bottlenecks appear:

1. **Manual decomposition is slow.** Breaking a 16-task project into actionable subtasks takes hours of planning time.
2. **Priority and sequencing are guesswork.** Without a dependency graph, teams start work that's blocked by incomplete prerequisites.
3. **Skill-matching is ad-hoc.** Assigning the right person (or agent) to the right task relies on tribal knowledge rather than structured data.
4. **Progress tracking is fragmented.** Status lives in Slack threads, spreadsheets, and heads — not in a single, queryable source of truth.

---

## What It Does

| Capability | Business Value |
|------------|---------------|
| **Plan Parsing** | Drop in a markdown or text plan; get structured tasks in seconds, not hours |
| **Complexity Scoring** | Every task gets a 1-10 score using heuristic analysis + optional AI refinement — no more gut-feel estimates |
| **Auto-Decomposition** | Tasks scoring 5+ are automatically broken into 3-10 actionable subtasks |
| **Dependency Tracking** | A built-in dependency graph ensures nothing starts before its prerequisites are done |
| **Readiness Engine** | The `ready` command instantly surfaces all tasks that can be worked on *right now* |
| **Skill Tagging** | Each task is tagged with required skills, enabling automated matching to the right agent or team member |
| **Delegation Manifest** | Machine-readable output (JSON/YAML) that a Team Lead agent consumes to assign work in parallel |
| **Multi-Project Support** | Manage multiple projects from a single installation with isolated state per project |
| **Configurable Workflows** | Preset task states (simple, standard, kanban) or fully custom workflows to match any team's process |

---

## How It Fits Into the AgentX Ecosystem

```
Implementation Plan (.md)
        │
        ▼
 ┌──────────────┐
 │  Taskmaster   │  ← Parses, scores, decomposes, tracks
 │  (this tool)  │
 └──────┬───────┘
        │
        ▼
   Delegation Manifest (JSON)
        │
        ▼
 ┌──────────────┐
 │  Team Lead    │  ← Reads manifest, assigns tasks
 │  Agent        │
 └──────┬───────┘
        │
   ┌────┼────┐
   ▼    ▼    ▼
 Agent Agent Agent   ← Specialized agents execute tasks in parallel
```

Taskmaster answers *"what needs to be done and in what order?"* — the Team Lead answers *"who does it?"*

---

## Key Differentiators

- **No external dependencies.** Runs entirely on the command line. No servers, no dashboards, no SaaS subscriptions required.
- **AI-enhanced, not AI-dependent.** Scoring works with or without GitHub Copilot — the heuristic engine provides a solid baseline.
- **Format-flexible.** Accepts plans in markdown, text, or YAML. Outputs in JSON, YAML, or formatted terminal views.
- **Agent-native.** Designed from the ground up for AI agent workflows, with machine-readable output that agents consume directly.
- **Configurable depth.** Supports four hierarchy styles — from flat checklists to full Epic > Story > Task > Subtask structures.

---

## Development Roadmap

| Phase | Focus | Key Deliverables |
|-------|-------|-----------------|
| **Phase 1: Foundation** | Core infrastructure | CLI framework, plan parser, configuration system, task states, template engine, authentication |
| **Phase 2: Scoring & Skills** | Intelligence layer | Heuristic scoring engine, AI scoring via Copilot, skill tagging and inference |
| **Phase 3: Decomposition & Delegation** | Workflow automation | Auto-decomposition, dependency graph, readiness engine, delegation manifest |
| **Phase 4: Polish** | Production readiness | CRUD commands, reporting suite, end-to-end testing, documentation |

**Future (v2):** External project management sync (Jira, Linear, Asana) via a standalone companion tool.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Plan-to-tasks accuracy | 90%+ tasks correctly extracted |
| Scoring reliability | Within 1.5 points of expert assessment |
| Subtask quality | 80%+ rated actionable by developers |
| Skill inference accuracy | 85%+ correct vs. manual tagging |
| Delegation correctness | 100% — no task marked ready with incomplete dependencies |
| CLI response time | < 2s local commands, < 10s AI scoring |
| Test coverage | 85%+ across core modules |

---

## Technology Summary

| Area | Choice | Why |
|------|--------|-----|
| Language | TypeScript on Node.js | Type safety, broad ecosystem, fast CLI startup |
| AI Provider | GitHub Copilot | Leverages existing subscriptions — no separate API keys |
| Data Strategy | JSON (internal) + YAML (human-facing) | Machine speed where it matters, readability where people look |
| Testing | Vitest | Fast, TypeScript-native, ESM-compatible |

---

## Who Uses It

- **AI Agent Teams** — Primary consumer. The Team Lead agent calls Taskmaster to get delegation manifests and assign work.
- **Engineering Leads** — Use it to rapidly decompose plans, assess complexity, and track progress across multiple projects.
- **Individual Contributors** — Run `next` to get the highest-priority unblocked task; run `ready` to see what's available.

---

## Contact

For questions about AgentX Taskmaster, reach out to the development team or review the full implementation plan at `.plans/agentx-taskmaster-implementation-plan.md`.
