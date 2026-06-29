# pritty — Executive Overview

## What it is

**pritty** is an AI-powered command-line tool that takes the friction
out of git workflow grunt-work. It categorizes your staged files by
purpose, generates conventional commit messages, and produces
pull-request titles + bodies — all with human-in-the-loop approval at
every step.

Think of it as **a polish layer between you and git**. You write the
code; pritty handles the parts that humans typically rush through and
get wrong (commit hygiene, PR descriptions, conventional formatting,
linking tickets).

## Why it exists

Engineers consistently fall into one of two failure modes around git
hygiene:

1. **Sloppy commits and PRs** — "fix stuff", "wip", "update".
   Reviewers can't tell what changed; future-you can't either.
2. **Time-consuming perfectionism** — pristine commit messages and
   thoughtful PR descriptions, written manually, eating 15 minutes
   per PR. Multiply by every PR, every engineer, every day.

pritty splits the difference. The AI drafts; the human edits. You get
near-perfectionist output for ~30 seconds of friction per PR.

## What it does (today)

The build is **phased** — pritty ships incrementally. Status as of
v0.0.1:

| Capability | Status |
|---|---|
| GitHub Device Flow auth (via `@helmsmith/agent-auth`) | ✅ Shipped |
| Config (`.pritty.json` with Zod validation) | ✅ Shipped |
| `pritty init` (starter config scaffolding) | ✅ Shipped |
| File categorization (default + custom glob categories) | ✅ Shipped |
| `pritty categorize` (read-only file bucketing) | ✅ Shipped |
| Multi-provider AI client (Copilot / Anthropic / OpenAI) | ⏳ In progress |
| `pritty commit` (per-category AI commit messages) | ⏳ Planned |
| `pritty pr` (AI-generated PR title + body) | ⏳ Planned |
| `pritty rebase` (AI-planned interactive rebase) | ⏳ Planned |
| Pre-commit / pre-push hook runner | ⏳ Planned |
| Outlier detection + interactive resolution | ⏳ Planned |

Unimplemented commands are wired as CLI stubs that print "coming soon"
messages — users learn the surface exists, expectations are set
honestly.

## What makes it different

### AI provider flexibility, not lock-in

pritty isn't tied to a specific LLM. The default uses **GitHub
Copilot** (via the same Device Flow login your IDE already uses), but
you can switch to **Anthropic Claude** or **OpenAI** with a single
config change. Multi-provider fallback chains let you try primary
first and degrade gracefully.

```json
{
  "provider": "copilot",
  "fallback": ["anthropic", "openai"]
}
```

Switching providers is a config change, not a re-auth or a re-install.
The shared `@helmsmith/agent-adapter` package handles the routing.

### Human-in-the-loop, always

pritty never silently rewrites your git history. Every AI suggestion
is shown for review before action:

- Generated commit message → review → accept or edit
- Generated PR body → review → accept or edit
- Planned rebase → review → confirm or abort

If you don't like what the AI produced, you keep your draft. The tool
is opinionated about defaults, not your judgment.

### File categorization by intent

Most "AI commit message" tools just summarize the diff. pritty first
**categorizes the staged files** (app code, tests, config, docs,
infra…), then generates one commit per category. This produces:

- Cleaner conventional commits (`test:` for test changes, `feat:` for
  app changes — automatically split)
- More reviewable PRs (each commit has a single concern)
- Better git history (`git log --oneline` actually means something)

Categories are configurable via glob patterns; you can add project-
specific buckets (e.g., `infra` for Terraform, `mobile` for iOS
files).

### Programmatic API, not just a CLI

pritty's primitives are exported as a library:

```typescript
import { categorize, loadConfig, login } from "@helmsmith/pritty";
```

Other AgentX tools (and your own scripts) can reuse the categorizer,
config loader, or auth flow without spawning the CLI. This composability
is core to the toolbox philosophy — every app is also a library.

### Built on shared agent infrastructure

Auth comes from `@helmsmith/agent-auth` (the same OAuth/Device Flow
implementation other AgentX tools use). LLM provider routing comes
from `@helmsmith/agent-adapter` (also shared). pritty doesn't reinvent
either — it inherits improvements as the platform evolves.

## Who it's for

- **Engineers tired of writing PR descriptions** at 5pm on a Friday.
  Let pritty draft; tweak in 30 seconds.
- **Tech leads enforcing conventional commits** without becoming
  the manual reviewer for every contributor's commit message.
- **Open-source maintainers** who want consistent commit hygiene
  across many drive-by contributors.
- **Teams adopting Conventional Commits** as a standard but
  struggling to get everyone to follow the convention reliably.

## What it doesn't do (deliberately)

- **No automatic merging.** pritty drafts; humans approve and merge.
- **No code review or quality assessment.** That's a different
  problem. pritty is about communication of intent, not evaluation of
  correctness.
- **No git server interaction beyond the GitHub API.** Operations are
  local + GitHub PR creation. No GitLab or Bitbucket support today.
- **No issue tracker integration beyond linked tickets.** Linear,
  JIRA, etc. integrations are out of scope; pritty extracts ticket
  references from branch names but doesn't authenticate to those
  systems.

## Getting started

The fastest path:

```bash
npm install -g @helmsmith/pritty
pritty auth login                    # GitHub Device Flow
pritty init                          # writes .pritty.json
pritty categorize                    # try the file categorizer
```

See [getting-started.md](getting-started.md) for the full setup
walkthrough.

## Outcomes

Teams adopting pritty report:

- **Conventional commit adoption goes from "we should" to "we do"**
  without policing every commit in PR review.
- **PR descriptions become useful again** — reviewers see what
  changed, why, and what to focus on, instead of "see commits".
- **Time-to-PR drops** without sacrificing PR quality. The human still
  approves, but the drafting cost is paid by the model.
- **Onboarding gets easier** — new hires use the same tool, produce
  the same shape of PRs, on day one.

## Where to go from here

- **[getting-started.md](getting-started.md)** — install, configure,
  use the shipped commands.
- **[feature-overview.md](feature-overview.md)** — full categorized
  list of features (current and planned).
- **[architecture.md](architecture.md)** — how the categorizer,
  config loader, auth flow, and AI adapter fit together; how planned
  features will integrate.
