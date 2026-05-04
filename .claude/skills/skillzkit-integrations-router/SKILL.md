---
name: skillzkit-integrations-router
description: Route external-service intent to the right slash command in the skillzkit suite. Fires when the user wants to file or update a GitHub issue or pull request, create a Jira ticket or sprint, read or update a Figma file, post to or read from LinkedIn / X / Instagram / Reddit, send a Discord or Microsoft Teams message, send Outlook email or check a calendar, write a OneDrive file, schedule a cross-platform social post via Hootsuite, search Datadog logs / metrics / monitors, search Splunk events, query SEMrush keyword or backlink data, or set up credentials for any of those services. Also fires for verb phrases like file a ticket, open a PR, post on social, send a message, search logs, query analytics, or publish a release. Prefer this router over product/engineer/market/tools when the verb is a remote-service action and the noun is a service name.
---

# skillzkit-integrations-router

Routes natural-language intent for **remote services** — anything
that requires authentication and reaches an external API — to
the correct slash command.

> **NOTE TO INSTALLER**: at install time, regenerate this
> router's body to list **only** integrations active in the
> consuming project's `product/.pencil-integrations.json`.
> The static version below is the template covering all 14
> services. The deployed router should reflect the project's
> actual configuration, including which interfaces (CLI / MCP /
> REST) are wired up and any multi-instance setup.

## In scope

The 14 declared integrations plus the four management commands:

- **Issue tracking** — Jira
- **Code hosting** — GitHub (multi-instance for GH Enterprise)
- **Design** — Figma
- **Microsoft 365 (shared Microsoft Graph auth)** — Outlook,
  OneDrive, Teams
- **Messaging** — Discord, Teams
- **Social network publishing** — LinkedIn, Instagram, Reddit,
  X (with Hootsuite delegation when configured)
- **Marketing platforms** — Hootsuite (write delegate)
- **Marketing intelligence** — SEMrush (read-only)
- **Observability** — Datadog, Splunk (multi-instance for prod
  vs security)
- **Setup / management** — `/core:integrations:setup`,
  `/core:integrations:manifest`, `/core:integrations:credentials`,
  `/core:integrations:declare`

## Out of scope

- **Drafting copy / generating content** →
  `skillzkit-market-router` (this router *publishes* content
  the market router *generates*)
- **Running local builds / tests / linters** →
  `skillzkit-tools-router`
- **Personas, journeys, design tokens** →
  `skillzkit-product-router`
- **Architecture, ADRs, code remediation** →
  `skillzkit-engineer-router`

## Routing decision rules

### Generation vs publishing

This router is the **publishing side** of every content flow:

- If the user says "write a tweet", that's market-router.
- If the user says "post that tweet", that's this router.
- If the verb is **send / post / publish / file / open / create**
  on an external service, route here.

### Read vs write asymmetry

Reads through this router are usually safe and need no
confirmation:

- "What does the latest issue say?" — read GitHub
- "Show me last week's Datadog incidents" — read Datadog
- "What's in the Figma file?" — read Figma

Writes touch real systems. **Always confirm** before:

- Filing tickets / issues / PRs
- Sending messages or emails
- Posting to social networks
- Modifying calendar events
- Updating Datadog monitors / Splunk alerts
- Modifying Figma files
- Provisioning anything (Datadog dashboards, Jira sprints, etc.)

When the user says "post X to LinkedIn", restate the post and
target before invoking the publishing command.

### Action vs question

- "How does the GitHub integration auth work?" → answer; do
  not invoke.
- "What's the difference between Jira issues and GitHub issues
  in our setup?" → answer.
- "File a ticket" → route.

### Tense awareness

- "I posted on LinkedIn yesterday" → past tense; ask if they
  want analytics, not to repost.
- "Let's post this", "publish this" → route.

### Confirmation before high-stakes (write side)

The integrations layer is where most irreversible actions
happen. Confirm before any of these:

- Posting to public social platforms
- Sending email to real recipients
- Filing tickets that will page on-call
- Modifying Datadog monitors (tied to alerting)
- Changing access in Splunk (tied to compliance)
- Force-pushing branches via `/core:integrations:github`
- Deleting messages in Discord / Teams
- Approving a Hootsuite scheduled post

### Manifest awareness

Every routing decision starts with reading
`product/.pencil-integrations.json`:

- Which integrations are configured (a service the user names
  may not be set up)
- Which interface variant the project uses for each service
  (CLI / MCP / REST)
- Whether the integration has multiple instances and which is
  default
- Whether write delegation is enabled (Hootsuite for social)

If the requested integration is not in the manifest, route to
`/core:integrations:setup` first or tell the user it's unavailable.

### Credentials health

If a write fails with auth errors, route to
`/core:integrations:credentials` (doctor mode) before retrying.
Don't paper over auth failures.

### Override is cheap

If the user says "actually post to X instead of LinkedIn", drop
and re-route.

---

## Command catalog

### Setup / management

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:setup`                            | Configure or verify an integration's authentication                  |
| `/core:integrations:manifest`                         | Query or manage the integrations runtime manifest                    |
| `/core:integrations:credentials`                      | Credential lifecycle help — doctor mode, rotation, keychain health    |
| `/core:integrations:declare`                          | Add a new integration definition to the registry                     |

### Issue tracking

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:jira`                             | Issues, sprints, projects, workflows on Jira (CLI / MCP / REST)      |

**Disambiguation** — "create a ticket":

- If only Jira is configured → `/core:integrations:jira`.
- If GitHub Issues is the project's tracker → `/core:integrations:github`.
- If both are configured, ask. The choice is project-specific
  and shouldn't be guessed.

### Code hosting

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:github`                           | Repos, issues, PRs, releases, GitHub Actions (CLI / MCP / REST)      |

**Multi-instance** — GitHub may be configured with multiple
instances (public github.com + GH Enterprise). When writing,
require explicit instance specification if more than one is
present in the manifest. Default to public for reads if a single
default is set.

**Hard rule** — never `git push --force` to `main` or `master`.
Refuse and explain. Force-pushing topic branches is allowed but
warn the user before doing so.

### Design

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:figma`                            | Files, components, styles, variables, comments, frame exports       |

**Disambiguation** — read vs write:

- Reading Figma metadata, screenshots, design tokens → safe;
  invoke directly.
- Writing back to Figma (creating files, updating components) →
  confirm first; surface what will change.

For Figma round-trip flows (designer in Figma, source of truth
in Pencil), the workflow lives in product-router
(`design:figma-roundtrip`). This router handles the raw Figma
read / write inside that workflow.

### Microsoft 365 (shared Microsoft Graph auth)

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:outlook`                          | Email, calendar, contacts via Microsoft Graph                        |
| `/core:integrations:onedrive`                         | File storage operations via Microsoft Graph                          |
| `/core:integrations:teams`                            | Teams channels, chats, meetings, team metadata via Microsoft Graph   |

These three share authentication via the Microsoft Graph
provider (`integrations/_auth-provider-microsoft-graph`). One
auth flow services all three; if the user authenticates for
Outlook, OneDrive and Teams come along.

### Messaging

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:discord`                          | Discord channels, threads, server operations (REST)                  |
| `/core:integrations:teams`                            | (also) Teams chat / channel messaging via Microsoft Graph            |

**Disambiguation** — "send a message":

- For developer / community communication → Discord (typically).
- For internal corporate communication → Teams.
- Confirm the audience before invoking.

### Social network publishing

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:linkedin`                         | LinkedIn posts, articles, mentions, analytics (REST)                 |
| `/core:integrations:instagram`                        | Instagram read (reads always direct); writes per delegation rule    |
| `/core:integrations:reddit`                           | Reddit post listings, comment threads, subreddit info (read)        |
| `/core:integrations:x`                                | X (formerly Twitter) reads; writes per delegation rule               |

**Write delegation** — if `product/.pencil-integrations.json`
has `hootsuite` configured AND the social channel is in
`hootsuite.managedChannels`:

1. Default writes to delegate through Hootsuite
   (`/core:integrations:hootsuite`).
2. Surface the delegation: "Routing through Hootsuite for
   LinkedIn — that's how the project is configured."
3. If the user passes `--use-direct-write`, skip delegation and
   call the channel-specific command.

**Reads always go direct** — never through Hootsuite. Hootsuite
is a publishing surface, not a read source.

### Marketing platforms

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:hootsuite`                        | Cross-platform social publishing and scheduling (REST)               |

Hootsuite is primarily a **delegation target** for the social
commands above. Direct invocation is appropriate for
Hootsuite-specific operations (viewing the publishing queue,
managing approval workflows).

### Marketing intelligence

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:semrush`                          | Keyword research, domain analysis, backlinks, traffic data (REST)    |

SEMrush is **read-only**. Use for ad copy research
(`/market:ads:search`) and SEO audits (`/product:strategy:seo`).

### Observability

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:integrations:datadog`                          | Metrics, logs, monitors, dashboards, incidents, RUM, APM             |
| `/core:integrations:splunk`                           | Log search, metrics, alerts, dashboards (CLI + REST)                 |

**Disambiguation** — "search logs":

- Project standardized on Datadog → `/core:integrations:datadog`.
- Project standardized on Splunk → `/core:integrations:splunk`.
- Both configured → ask. Some shops use Splunk for security
  events specifically and Datadog for everything else.

**Multi-instance handling (Splunk)** — Splunk is commonly
configured with multiple instances (production logs vs security
events). When writing or running ad-hoc searches:

- Require explicit instance specification.
- For instances flagged with `complianceMode: "strict"` (typical
  for the security instance), surface the compliance flag and
  require explicit confirmation before invoking.
- Reads against a strict-mode instance still require
  confirmation; the compliance audit may log the query.

---

## Cross-router handoffs

### From `skillzkit-market-router` (publishing)

This is the most common inbound flow. Market-router generates
content; this router publishes:

| Generated by market-router          | Published by                                            |
| ----------------------------------- | ------------------------------------------------------- |
| `/market:social:linkedin`           | `/core:integrations:linkedin` or `/core:integrations:hootsuite`   |
| `/market:social:x`                  | `/core:integrations:x` or `/core:integrations:hootsuite`          |
| `/market:social:instagram`          | `/core:integrations:instagram` or `/core:integrations:hootsuite`  |
| `/market:social:facebook`           | `/core:integrations:hootsuite` (or platform direct)          |
| `/market:social:tiktok`             | `/core:integrations:hootsuite` (no direct write integration) |
| `/market:email:promotional`         | `/core:integrations:outlook`, Gmail, or marketing platform   |
| `/market:email:newsletter`          | `/core:integrations:outlook` or marketing platform           |
| `/market:pr:journalist-outreach`    | `/core:integrations:outlook`                                 |
| `/market:pr:press-release` (wire)   | Wire service via integrations + LinkedIn company post   |

### From `skillzkit-product-router`

| Originating intent                                              | Route to                            |
| --------------------------------------------------------------- | ----------------------------------- |
| Story-map slice → bulk Jira / GitHub tickets                    | `/core:integrations:jira` or `:github`   |
| Journey or persona docs → Confluence                            | `/core:integrations:jira` (Atlassian)    |
| Figma round-trip read / write                                   | `/core:integrations:figma`               |
| Design assets → OneDrive for sharing                            | `/core:integrations:onedrive`            |

### From `skillzkit-engineer-router`

| Originating intent                                              | Route to                            |
| --------------------------------------------------------------- | ----------------------------------- |
| ADR → Confluence page                                           | `/core:integrations:jira` (Atlassian)    |
| Maintenance findings → GitHub issues                            | `/core:integrations:github`              |
| Status update for engineering team                              | `/core:integrations:teams` or `:discord` |
| Ops dashboards / monitors                                       | `/core:integrations:datadog` or `:splunk`|

### From `skillzkit-tools-router`

| Originating intent                                              | Route to                            |
| --------------------------------------------------------------- | ----------------------------------- |
| CI build failure notification                                   | `/core:integrations:discord` or `:teams` |
| Test failure → file a tracking issue                            | `/core:integrations:github` or `:jira`   |
| Visual regression review needed                                 | `/core:integrations:github` (PR comment) |

---

## Multi-instance and delegation cheat sheet

### Multi-instance pattern

Some integrations allow multiple configured instances:

| Service     | Typical instances                                  |
| ----------- | -------------------------------------------------- |
| GitHub      | github.com + GitHub Enterprise                     |
| Splunk      | production + security (with strict compliance)     |
| Jira        | company instance(s); some teams have more than one |
| Outlook     | personal vs corporate tenant                       |

Write rule: **explicit instance specification required**. If the
user says "post to GitHub", check the manifest for instances.
If exactly one is configured, use it. If multiple, ask.

### Delegation pattern (Hootsuite)

| Channel    | Direct command           | Delegate (when configured)  |
| ---------- | ------------------------ | --------------------------- |
| LinkedIn   | `/core:integrations:linkedin` | `/core:integrations:hootsuite`   |
| Instagram  | `/core:integrations:instagram`| `/core:integrations:hootsuite`   |
| Reddit     | `/core:integrations:reddit`   | `/core:integrations:hootsuite`   |
| X          | `/core:integrations:x`        | `/core:integrations:hootsuite`   |
| Facebook   | (no direct write)        | `/core:integrations:hootsuite`   |
| TikTok     | (no direct write)        | `/core:integrations:hootsuite`   |

Default: delegate through Hootsuite if it's in
`hootsuite.managedChannels`. Override with `--use-direct-write`.

### Compliance flag (Splunk security instance)

When the manifest entry for a Splunk instance has
`complianceMode: "strict"`:

- All operations against it (read or write) surface the flag
  in the routing message.
- Writes require explicit confirmation.
- The query may be logged for audit; warn the user.

---

## Anti-patterns

Do not:

- **Publish without confirmation.** Restate the content and the
  target before invoking any write command.
- **Force-push to main.** Refuse. Explain.
- **Guess between Datadog and Splunk.** Both are observability;
  the choice is project-specific and unguessable from intent.
- **Delegate reads through Hootsuite.** Reads go direct.
- **Skip the compliance check on strict-mode Splunk
  instances.** The flag exists for a reason.
- **Auto-route social writes to Hootsuite when delegation isn't
  configured.** Check `hootsuite.managedChannels`; if absent,
  use the channel-direct command.
- **Send personalized journalist pitches without confirming the
  recipient list.** That's a market-router concern that often
  bleeds into this router on the publishing side.
- **Pretend integrations exist that aren't installed.** Read
  `product/.pencil-integrations.json` first; if a requested
  service is missing, route to `/core:integrations:setup`.
- **Match keywords without checking tense.** "I sent the
  email" / "I filed a ticket" are past-tense reports, not
  requests.
- **Bypass auth failures with retries.** If a write fails on
  auth, route to `/core:integrations:credentials` first.