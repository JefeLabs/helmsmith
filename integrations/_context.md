# Integrations — Grouping Context

> Remote service invocations. Read this when working with
> `integrations/` namespace or building commands that call
> external hosted services.
>
> The integrations namespace is a peer to `tools/` and
> `frameworks/`. It serves user-facing slash commands for
> direct invocation AND a registry of integration metadata
> consumed by suite commands and external skills.

## What integrations are

Integrations are **remote service invocations** — calls to
hosted services over network protocols, with identity-level
authentication, that affect persistent state in those
services.

In scope:
- Issue tracking (Jira, Linear, GitHub Issues)
- Knowledge bases (Confluence, Notion)
- Email + Calendar + Files (Microsoft 365 stack, Google Workspace)
- Messaging (Slack, Teams, Discord)
- Code hosting (GitHub, GitLab, Bitbucket)
- Marketing platforms (Mailchimp, Buffer, LinkedIn, X)
- CRM (Salesforce, HubSpot)
- Observability (Datadog, Splunk, Sentry, New Relic)
- Payments (Stripe)

Out of scope (these are tools, not integrations):
- Local CLI invocations (Playwright, pixelmatch, ImageMagick) —
  see `tools/` namespace
- Build ecosystems (npm, Maven, Gradle, Terraform) — see `tools/`
- Framework adapters (Storybook, HeroUI binding) — see
  `frameworks/`
- TUI environments (claude-code, opencode, copilot CLI) —
  these run the suite; the suite doesn't invoke them

The boundary heuristic: **if it requires authenticating to a
hosted service over the network, it's an integration. If it
runs locally, it's a tool.**

## Three interfaces per integration

Each integration may be invokable through up to three interfaces:

- **CLI** — service-specific command-line tool (`gh` for
  GitHub, `splunk` SDK for Splunk, `dogapi` / `datadog-ci`
  for Datadog). Stable, well-documented, what most developers
  reach for when scripting.
- **MCP** — Model Context Protocol server for the service
  (Atlassian MCP, GitHub MCP). Newer; uneven coverage across
  services.
- **REST** — direct HTTPS calls to the service's REST API.
  Lowest-common-denominator; available for nearly every
  service.

Some integrations have all three. Some have only REST. The
schema captures per-interface availability and metadata.

## CLI is the default preference

When CLI is available, it's the recommended default:

- CLIs are stable across versions
- Well-documented (man pages, official guides)
- Well-tested (used by service vendors' own teams)
- What developers expect to reach for

MCP becomes preferred when richer agentic interactions matter
(structured queries with rich return types, complex multi-step
operations). REST is the fallback when neither CLI nor MCP is
available, OR when the user explicitly chooses (sometimes
for compliance — direct API gives more visibility into
exactly what's being called).

Setup recommends CLI by default when available, with explicit
override available.

## No automatic fallback

If the user's preferred interface is unavailable at runtime
(CLI not installed in current environment; MCP server not
connected; REST credentials missing), the command **does NOT
silently fall back to a different interface.** Instead it
prompts:

```
Your Jira preference is 'cli' but the CLI isn't currently
available. Options:
  [r] Retry CLI (after fixing the issue)
  [m] Use MCP for this invocation only
  [s] Use REST for this invocation only
  [c] Change preference permanently
  [a] Abort
```

The user retains explicit control. Silent fallback hides
operational state and can produce unexpected results
(MCP-level capability vs REST-level capability differs;
auth mechanisms differ).

## Credential storage via OS keychain

The suite delegates credential storage to OS-native tooling:

- **macOS**: `security` command (Keychain)
- **Linux**: `secret-tool` (libsecret; backed by GNOME
  Keyring or KWallet)
- **Windows**: `cmdkey` / PowerShell credential cmdlets

The suite NEVER implements crypto. The OS handles encryption
at rest, decryption at use, key management.

See `integrations/_keychain-helper.md` for the cross-platform
abstraction commands rely on.

### Per-credential storage choice

Each credential has a storage type:

- **`keychain`** — for secrets (API tokens, OAuth refresh
  tokens, passwords). Default for sensitive values. OS keychain
  manages encryption.
- **`env`** — for non-sensitive identifiers (email addresses,
  instance URLs, account IDs). Read from environment at
  invocation time.

Setup walks through each credential and recommends storage
type based on sensitivity. User overrides if needed.

### CI / automation environments

CI runners and headless environments often don't have
keychain backends. The keychain helper detects this:

```bash
if ! keychain_available; then
  # Fall back to env-only mode
  echo "Keychain not available in this environment;"
  echo "credentials must be provided via env vars"
fi
```

When keychain isn't available, all credentials become env-var
based. The integrations command surfaces this clearly: "this
project's manifest expects keychain storage, but this
environment doesn't support it; provide via env vars
{name1, name2, ...}."

## Multi-instance integrations

Some integrations support multiple endpoints/instances of the
same type:

- Splunk: prod / staging / security-specific instances
- GitHub: github.com + GitHub Enterprise
- Jira: multiple Atlassian organizations

The schema accommodates both single-instance and multi-instance
shapes. Single-instance is the default; multi-instance is
opt-in per integration via the manifest.

## Compliance-aware defaults

Financial services, healthcare, and other regulated industries
have credential management requirements:

- Credentials must rotate (typical: 90 days)
- Credential access should be auditable
- Plaintext storage on disk is unacceptable
- Multi-factor authentication where possible

The integrations namespace defaults match these:

- Credentials marked sensitive default to `keychain` storage,
  not `env`
- The schema supports `maxCredentialAgeDays` per integration
- Doctor mode surfaces credentials approaching rotation
- The setup walkthrough explicitly mentions when credentials
  will be in plaintext (env-var case) vs encrypted (keychain
  case) so users in compliance-sensitive contexts make
  informed choices

## Shared auth across related integrations

Some integrations share authentication infrastructure:

- **Microsoft 365 stack** (Outlook, OneDrive, Teams): all
  authenticate via Microsoft Graph. One OAuth flow grants
  access to all three.
- **Google Workspace** (Gmail, Calendar, Drive): all
  authenticate via Google OAuth. Similar pattern.

The schema supports a shared-auth pattern. When integrations
declare a shared auth provider, setup runs once and credentials
are referenced by multiple integrations:

```jsonc
{
  "integrations": {
    "outlook": {
      "active": true,
      "authProvider": "microsoft-graph",
      ...
    },
    "onedrive": {
      "active": true,
      "authProvider": "microsoft-graph",
      ...
    }
  },
  "authProviders": {
    "microsoft-graph": {
      "credentials": {
        "MICROSOFT_GRAPH_TOKEN": {
          "storage": "keychain",
          "service": "skillz-microsoft-graph",
          "account": "default"
        }
      }
    }
  }
}
```

The user authenticates once; multiple integrations consume the
same auth.

## Write delegation (publishing platforms)

Some integrations are publishing destinations (LinkedIn,
Instagram, Reddit, X) where write operations are commonly
delegated to a scheduling/publishing platform like Hootsuite
or Buffer. The suite supports this pattern explicitly.

**Pattern:** Direct platform integrations have full read+write
capability. When a publishing-platform delegate (Hootsuite,
Buffer) is configured for the integration, write operations
route through the delegate by default. Read operations always
use the direct platform API.

Why this asymmetry: scheduling platforms are good at the write
path (cross-platform queueing, optimal-time scheduling, batch
operations) but typically don't expose the rich read data
(detailed analytics, mention monitoring, audience insights)
that direct platform APIs provide.

### Manifest representation

```jsonc
{
  "integrations": {
    "linkedin": {
      "active": true,
      "preference": "rest",
      "interfaces": { "rest": { ... } },
      "writeDelegation": {
        "enabled": true,
        "delegate": "hootsuite",
        "channelId": "abc123",
        "fallbackToDirect": true
      },
      "credentials": {
        "LINKEDIN_ACCESS_TOKEN": { "storage": "keychain", ... }
      }
    },
    "hootsuite": {
      "active": true,
      "preference": "rest",
      "interfaces": { "rest": { ... } },
      "managedChannels": [
        {
          "platform": "linkedin",
          "channelId": "abc123",
          "displayName": "LinkedIn — @jefelabs"
        },
        {
          "platform": "instagram",
          "channelId": "def456",
          "displayName": "Instagram — TourneySeason"
        }
      ]
    }
  }
}
```

### Routing logic

Each direct platform integration command interprets its prompt
and classifies the operation as read or write:

```bash
classify_operation() {
  local PROMPT="$1"
  # Heuristics: keywords like "post", "publish", "create",
  # "share", "comment" → write; "show", "find", "search",
  # "fetch", "list", "analyze" → read
  ...
}

OPERATION=$(classify_operation "$PROMPT")

if [ "$OPERATION" = "write" ]; then
  # Check delegation
  DELEGATE=$(jq -r '.integrations.linkedin.writeDelegation.delegate // empty' \
                  product/.pencil-integrations.json)
  ENABLED=$(jq -r '.integrations.linkedin.writeDelegation.enabled // false' \
                  product/.pencil-integrations.json)
  
  # Per-invocation override
  if [ "$USE_DIRECT" = "true" ]; then
    DELEGATE=""
  fi
  
  if [ -n "$DELEGATE" ] && [ "$ENABLED" = "true" ]; then
    # Route through delegate
    delegate_write "$DELEGATE" "$PROMPT"
  else
    # Direct write
    direct_write "$PROMPT"
  fi
else
  # Reads always direct
  direct_read "$PROMPT"
fi
```

### Per-invocation override flags

- `--use-direct` — force direct API for this invocation
  (overrides delegation default for write operations)
- `--use-delegate` — force delegate routing (rarely needed
  since delegation is the default when configured; useful for
  testing)

### Delegation failure handling

Per the no-automatic-fallback principle: when delegate
unavailable at runtime, the command stops and prompts:

```
Your LinkedIn write delegation is set to Hootsuite, but
Hootsuite isn't currently usable.

  [r] Retry Hootsuite (after fixing credentials)
  [d] Use LinkedIn direct API for this invocation only
  [c] Change delegation permanently (disable; use direct)
  [a] Abort
```

When `fallbackToDirect: false`, option [d] is hidden — the
integration refuses to write outside the delegate.

## Runtime manifest

Integration state lives at `product/.pencil-integrations.json`:

```jsonc
{
  "version": 1,
  "lastUpdated": "<ISO timestamp>",

  "integrations": {
    "jira": {
      "active": true,
      "preference": "cli",
      "instanceUrl": "https://company.atlassian.net",
      
      "interfaces": {
        "cli": { ... },
        "mcp": { ... },
        "rest": { ... }
      },
      
      "credentials": {
        "JIRA_EMAIL": {
          "storage": "env"
        },
        "JIRA_API_TOKEN": {
          "storage": "keychain",
          "service": "skillz-jira",
          "account": "api-token"
        }
      },
      
      "scopes": ["read:jira-work", "write:jira-work"],
      "perResourceScoping": {
        "projects": ["SCOOL", "TS"]
      },
      
      "lastDetected": "...",
      "lastVerified": "...",
      "lastReviewed": "..."
    }
  },

  "authProviders": {
    // For shared-auth integrations like Microsoft 365
  },

  "stalenessThresholds": {
    "verificationDays": 14,
    "reviewDays": 180,
    "credentialRotationDays": 90
  }
}
```

Schema: `.product-integrations-schema.json` at suite root.

## How suite commands consume integrations

Most integrations are user-invoked or workflow-invoked, not
heavily called by other commands as building blocks. This
differs from tools, which suite commands use constantly.

When a suite command DOES need an integration (e.g., a workflow
that creates Jira tickets after a launch), it follows this
pattern:

```bash
# Pre-flight: verify integration active
ACTIVE=$(jq -r '.integrations.jira.active // false' \
              product/.pencil-integrations.json 2>/dev/null)

if [ "$ACTIVE" != "true" ]; then
  echo "Jira integration not active. Run /integrations:setup jira"
  exit 1
fi

# Get preference and resolve credentials
PREFERENCE=$(jq -r '.integrations.jira.preference' product/.pencil-integrations.json)

# Resolve credentials per storage type
JIRA_EMAIL=$(resolve_credential "jira" "JIRA_EMAIL")
JIRA_API_TOKEN=$(resolve_credential "jira" "JIRA_API_TOKEN")

# Invoke per preference
case "$PREFERENCE" in
  cli) jira issue create ...;;
  mcp) # use mcp__atlassian__* tools ;;
  rest) curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" ...;;
esac
```

The `resolve_credential` helper handles keychain vs env
transparently. See `_keychain-helper.md`.

## How external SKILL.md files consume integrations

External skills declare integration dependencies in
frontmatter:

```yaml
---
name: my-custom-skill
requiredIntegrations:
  - jira
  - github
optionalIntegrations:
  - confluence
---
```

A skill harness reads this and verifies each required
integration is active in `.pencil-integrations.json` before
proceeding. Missing integrations route to
`/integrations:setup <name>`.

## Staleness discipline

Integrations have richer staleness concerns than tools:

| Timestamp | Threshold (default) | Action |
|-----------|---------------------|--------|
| `lastVerified` | 14 days | Soft warning; suggest `--check` |
| `lastReviewed` | 180 days | Annual workflow prompts review |
| Credential age | 90 days | Rotation reminder in doctor mode |

Compliance-sensitive contexts may set `credentialRotationDays`
shorter (e.g., 30 days for high-security environments).

Three verbs match the framework manifest pattern:
- `/integrations:setup` — full activation; updates all timestamps
- `/integrations:setup --check` — verification only;
  `lastVerified`
- `/integrations:manifest --review` — explicit review;
  `lastReviewed`
- Credential rotation reminders surface in
  `/integrations:credentials --doctor`

## Anti-patterns

- **Storing credentials in `.pencil-integrations.json`** —
  the manifest stores REFERENCES to where credentials live
  (keychain service/account, env var name); never values.
- **Implementing custom encryption in the suite** —
  delegate to OS keychain. The suite is not a credential
  manager.
- **Silent fallback between interfaces** — when preferred
  interface unavailable, prompt the user; don't pick silently.
- **Treating CLIs and integrations as the same** — local
  invocations are tools (under `tools/`); remote services
  are integrations (under `integrations/`). The boundary
  matters because auth, state, and consumption patterns
  differ.
- **Per-integration credential storage logic** — use the
  shared `_keychain-helper.md` abstraction. Per-integration
  variations risk inconsistency and bugs.
- **Cataloging environments as integrations** — claude-code,
  cursor, opencode are environments the suite runs IN, not
  services it integrates WITH.
