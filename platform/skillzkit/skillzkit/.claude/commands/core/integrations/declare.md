---
description: Add a new integration definition to the registry. Walks through metadata fields (provider, three-interface availability, auth method per interface, credentials needed, scopes, capabilities) and creates the integration's MD file under integrations/. Used when building new commands that depend on previously-uncatalogued integrations.
argument-hint: <integration-name> [--provider <name>] [--cli] [--mcp] [--rest] [--all-interfaces]
allowed-tools: Read, Write, Edit, Bash
---

Add a new integration definition to the suite's registry.
Used when building new commands that need integrations the
suite doesn't currently catalog.

The output is a new file at `integrations/<integration-name>.md`
matching the dual-purpose pattern: command body for
`/core:integrations:<name>` direct invocation + registry definition
for setup/manifest consumption.

## Phase 0: discovery

1. Verify `<integration-name>` doesn't already exist as an
   integration file.
2. Read `tools/_scaffold.md` (if exists) or
   `integrations/_scaffold.md` (when first integration is
   declared) for the template.
3. Read `integrations/_context.md` for current naming
   conventions and registered categories.

## Phase 1: gather metadata

### Integration name

```
Integration name: <provided>

Validation:
  ✓ Lowercase
  ✓ Hyphens or single-word (no underscores)
  ✓ Not already in registry
  ✓ Doesn't conflict with reserved names (setup, manifest,
    credentials, declare)
```

### Display name and provider

```
Display name (human-readable): [defaults to capitalized
                                integration-name]
> Linear

Provider (the company/service): 
> linear-app
```

### Category

```
Category:
  [1] issue-tracking      (Jira, Linear, GitHub Issues)
  [2] knowledge-base      (Confluence, Notion)
  [3] code-hosting        (GitHub, GitLab, Bitbucket)
  [4] email               (Gmail, Outlook)
  [5] calendar            (Google Calendar, Outlook Calendar)
  [6] file-storage        (OneDrive, Google Drive, Dropbox)
  [7] messaging           (Slack, Teams, Discord)
  [8] marketing-platform  (Mailchimp, Buffer)
  [9] crm                 (Salesforce, HubSpot)
  [10] observability      (Datadog, Splunk, Sentry, New Relic)
  [11] payments           (Stripe)
  [12] other              (specify)
```

### Interfaces

```
Available interfaces (multi-select):
  [c] CLI
  [m] MCP
  [r] REST

Choice (e.g., "cmr" for all three):
> cmr
```

#### Per-interface details

For each selected interface:

##### CLI

```
=== CLI Interface ===

Executable name (the command users invoke):
  [examples: 'jira', 'gh', 'splunk', 'datadog-ci']
> linear-cli

Install command:
  [examples: 'brew install go-jira', 'npm install -g @linear/cli']
> npm install -g @linear/cli

Detection command (how setup verifies it's installed):
  [examples: 'jira version', 'gh --version']
> linear-cli --version

Auth method:
  [t] Personal Access Token (env var)
  [o] OAuth flow (CLI handles)
  [k] API key (env var)
  [b] Browser-based authentication

Choice:
> o

If t/k:
  Auth env var name:
    [examples: 'LINEAR_API_KEY']
  > LINEAR_API_KEY
```

##### MCP

```
=== MCP Interface ===

MCP server name (the part after mcp__):
  [examples: 'atlassian', 'github']
> linear

Tool prefix (auto-derived):
> mcp__linear__

Auth model:
  [o] OAuth managed by MCP server
  [t] Token managed by MCP server
  [s] Server-side configuration (no per-user auth)

Choice:
> o
```

##### REST

```
=== REST Interface ===

Base URL pattern:
  [examples: 'https://{instance}.atlassian.net/rest/api/3']
  Use {instance} as placeholder for instance-specific URL
> https://api.linear.app/graphql

Auth method:
  [b] Bearer token in Authorization header
  [a] Basic auth (email + token)
  [k] API key in custom header
  [c] OAuth 2.0

Choice:
> b

Auth header pattern:
  [examples: 'Authorization: Bearer {token}']
> Authorization: {token}

Required env vars (comma-separated):
> LINEAR_API_KEY

Rate limit (requests/period):
> 1000/hour
```

### Multi-instance support

```
Does this integration support multiple instances/endpoints
(like Splunk environments or GitHub Enterprise)?
  [s] Single-instance only
  [m] Multi-instance supported

Choice:
> s
```

### Instance configuration (single-instance)

```
Instance URL pattern:
  [examples: 'https://yourcompany.atlassian.net']
> https://linear.app

Per-resource scoping (optional):
  Examples: project keys, workspace IDs, organization slugs
  Field name (e.g., 'projects', 'teams'):
> teams
```

### Scopes (for OAuth-based auth)

```
Required OAuth scopes (if applicable):
  [comma-separated]
> read,write
```

### Credentials inventory

For each credential the integration needs:

```
=== Credential 1 ===

Name (env var style): LINEAR_API_KEY
Description: Linear personal API key
Sensitive (defaults to keychain storage)? [Y/n]: Y
Where to obtain: https://linear.app/settings/api
```

Repeat for each credential.

### Direct-invocation depth

```
Direct-invocation prompt richness:
  [t] Thin — wrapper that interprets simple prompts
  [m] Medium — handles common operation patterns
  [r] Rich — substantial prompt-to-operation translation

Choice (affects how detailed the command body is):
> m
```

### Compliance flag

```
Compliance category (affects defaults):
  [s] Standard (most teams; defaults apply)
  [c] Compliance-sensitive (financial services, healthcare;
                            shorter rotation, stricter logging)

Choice:
> s
```

If compliance-sensitive, defaults adjust:
- `credentialRotationDays`: 30 (vs 90)
- All sensitive credentials default to keychain (no env override)

## Phase 2: generate the integration file

Build the file from template:

```markdown
---
description: Direct access to <Display Name> for <category-flavored
description>. Takes a free-form prompt — common operations
include <list>. Routes via <preference>; alternative interfaces
available.
argument-hint: <free-form-prompt> [--cli-only] [--mcp-only]
              [--rest-only] [--instance <id>]
allowed-tools: Read, Write, Edit, Bash<, mcp__<server>__* if MCP>
---

# Integrations — <Display Name>

Direct invocation of <Display Name> for <category> operations.
Useful when:
- One-off task that doesn't fit existing skillz commands
- Composing custom workflows
- Experimenting with the integration's capabilities

This command interprets your prompt and invokes the configured
preferred interface.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json` for integration
   state; verify integration is active.
2. Read preferred interface; verify it's available.
3. Resolve credentials per storage type via keychain helper.

## Phase 1: prompt interpretation

[Per the depth chosen, generate skeleton sections for common
patterns. The user can refine these later.]

## Phase 2: execution

[Skeleton invocation logic per preference]

## Phase 3: result reporting

Report results to the user.

## Cross-references

[Skeleton — user fills in cross-references to skillz commands
that compose with this integration]

---

# Registry definition

> The structured frontmatter and sections below are read by
> `/core:integrations:setup` and `/core:integrations:manifest`.

## Integration metadata

```yaml
name: <integration-name>
displayName: <display-name>
provider: <provider>
category: <category>
multiInstance: <true|false>
```

## Interfaces

[Per-interface details from Phase 1, in structured format
that setup.md parses]

## Credentials

[Per-credential entries with sensitivity classification,
where-to-obtain links, default storage type]

## Scopes

[Required OAuth scopes if applicable]

## Capabilities

[Operation matrix: query / create / update / delete / batch /
search / etc., with descriptions]

## Rate limits

[Per-interface rate limits where known]

## Required by skillz commands

<empty initially; populated by /core:integrations:setup --refresh-required-by>

## Compliance considerations

[Standard or compliance-sensitive notes]
```

## Phase 3: persist

Write `integrations/<integration-name>.md`. Update
`integrations/_index.md` to include the new integration in
the appropriate category section.

## Phase 4: report

```
=== Integration Declared ===

Integration:    linear
File:           integrations/linear.md
Provider:       Linear
Category:       issue-tracking
Interfaces:     CLI, MCP, REST

Next steps:
  - Review and refine the prompt-interpretation logic in
    integrations/linear.md (Phase 1: prompt interpretation)
  - Document cross-references to skillz commands that
    compose with this integration
  - Run /core:integrations:setup linear to configure auth and
    test connectivity
  - When commands that use this integration exist, run
    /core:integrations:setup --refresh-required-by to populate
    the required-by relationships
```

## What this command does NOT do

- **Configure auth.** That's `/core:integrations:setup`'s job.
- **Generate working command body logic.** The Phase 1
  prompt-interpretation section is a skeleton; user fills
  in integration-specific logic.
- **Auto-detect existing usage in the suite.** The
  `requiredBy` list starts empty.
- **Modify other integration files.** Each declaration is
  self-contained.

## Examples

```bash
# Declare a new integration
/core:integrations:declare linear

# Specify interfaces upfront
/core:integrations:declare linear --cli --mcp --rest

# Compliance-sensitive declaration
/core:integrations:declare custom-internal-jira \
  --provider atlassian \
  --all-interfaces
```
