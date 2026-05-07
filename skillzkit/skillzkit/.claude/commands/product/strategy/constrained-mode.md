---
description: Setup guide for running Pencil in locked-down environments — corporate networks with restricted outbound, regulated LLM provider lists (Copilot-only, Bedrock-only, etc.), no MCP server access, custom CA bundles. Reference doc; not an executable command.
allowed-tools: Read
---

Setup guide for running Pencil in environments where the default
configuration doesn't work. This is reference documentation, not an
executable command. Read for setup; the constrained behavior itself
is built into other commands when `PENCIL_MODE=constrained` is set.

## What "constrained" means

A constrained environment imposes one or more restrictions:

- **No MCP** — the Pencil MCP server can't be reached (corporate
  proxy blocks the WebSocket, or policy prohibits arbitrary outbound
  from developer machines)
- **Restricted LLM provider** — the organization mandates a specific
  provider (GitHub Copilot only, AWS Bedrock only, Azure OpenAI
  with allowlisted regions, on-prem provider, etc.). Anthropic
  direct API isn't allowed.
- **Outbound HTTPS via proxy** — Zscaler, custom corporate proxy,
  or content-filtering middleware. Most network calls work but
  TLS / certificate handling needs configuration.
- **Custom CA bundle** — corporate-issued root CAs that aren't in
  the default OS trust store
- **Air-gapped or limited internet** — no third-party content fetch
  for `tokens-from`, `research`, `imagery-select` vendor lookups

Pencil supports all five via `PENCIL_MODE=constrained` plus
provider-specific configuration.

## Detection — am I in a constrained environment?

Signals that constrained mode applies:

- Your organization has a "approved LLM tools" policy and Anthropic
  direct API isn't on it
- You can't reach `claude.ai` or `api.anthropic.com` from your
  development machine without a proxy
- `pencil --version` works but `pencil run any-command` fails with
  TLS / network errors
- IT has issued you a `corporate-ca.pem` file you have to install
  for HTTPS to work
- Your VS Code / Cursor has GitHub Copilot but no other LLM
  integrations

If two or more of these apply, you're in a constrained environment.

## Configuration

### 1. Activate constrained mode

In your project root (or your shell profile for project-wide):

```bash
# Project-level
echo "PENCIL_MODE=constrained" >> .env

# Or shell-level
export PENCIL_MODE=constrained
```

Once set, Pencil commands automatically:
- Skip MCP server discovery (Path A unavailable)
- Default to CLI invocation (Path B)
- Read provider-specific credentials from environment
- Honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`
- Read `NODE_EXTRA_CA_CERTS` for custom CA bundles

### 2. Provider-specific configuration

#### GitHub Copilot

For environments mandating Copilot as the LLM:

```bash
export PENCIL_LLM_PROVIDER=copilot
export GITHUB_TOKEN=<your-pat-with-copilot-scope>
```

The Pencil CLI's Copilot provider uses the GitHub Copilot Chat API
internally. This requires a paid Copilot license and GitHub Personal
Access Token with `copilot` scope.

Limitations of Copilot provider:
- No streaming; responses come whole
- No tool-calling (some Pencil commands that depend on `get_screenshot`
  loops degrade gracefully)
- Token limits per request smaller than Anthropic direct (8K vs 200K)
- Some commands may need to chunk operations that fit in one
  Anthropic call

#### AWS Bedrock

```bash
export PENCIL_LLM_PROVIDER=bedrock
export AWS_PROFILE=<profile-name>
export AWS_REGION=<region>
export PENCIL_BEDROCK_MODEL=anthropic.claude-sonnet-4-20250514-v1:0
```

Requires IAM permissions for `bedrock:InvokeModel` on the chosen
Anthropic model in the chosen region. The model string format is
Bedrock's, which differs from the Anthropic direct API model string.

#### Google Vertex AI

```bash
export PENCIL_LLM_PROVIDER=vertex
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export PENCIL_VERTEX_PROJECT=<gcp-project-id>
export PENCIL_VERTEX_LOCATION=us-east5
```

#### Azure OpenAI

```bash
export PENCIL_LLM_PROVIDER=azure
export AZURE_OPENAI_API_KEY=<key>
export AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
export PENCIL_AZURE_DEPLOYMENT=<deployment-name>
```

Note: Azure OpenAI doesn't currently host Anthropic models. This is
listed for completeness; in practice, Pencil with Azure OpenAI would
use a comparable model (GPT-4o, GPT-5) which produces lower quality
than Claude on the design tasks Pencil specializes in. Anthropic
direct or Bedrock is preferred.

#### On-prem or self-hosted

```bash
export PENCIL_LLM_PROVIDER=openai-compatible
export OPENAI_BASE_URL=https://<internal-endpoint>/v1
export OPENAI_API_KEY=<internal-key>
export PENCIL_MODEL=<model-name>
```

For on-prem deployments of Claude (via private cloud) or any
OpenAI-compatible API.

### 3. Network configuration

#### HTTPS proxy

```bash
export HTTPS_PROXY=http://corporate-proxy:8080
export HTTP_PROXY=http://corporate-proxy:8080
export NO_PROXY=localhost,127.0.0.1,*.internal-domain
```

The proxy URL format supports auth: `http://user:pass@proxy:8080`.
For more sensitive auth, use a `.netrc` file or proxy configuration
specific to your security tools.

#### Custom CA bundle

For corporate root CAs not in the default OS trust store:

```bash
# Node.js (used by Pencil CLI)
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca.pem

# Or for the entire system (preferred when possible)
# Linux: append to /etc/pki/tls/certs/ca-bundle.crt
# macOS: import to Keychain Access → System
```

Verify with:

```bash
curl -v https://api.anthropic.com  # should succeed
node -e "require('https').get('https://api.anthropic.com', r => console.log(r.statusCode))"
```

If the Node test passes, Pencil CLI will work.

#### Zscaler-specific notes

Zscaler intercepts TLS by re-signing certificates with a Zscaler-
provided root CA. To work with it:

1. Get the Zscaler root CA from your IT team (typically distributed
   as `zscaler-root.pem` or via group policy)
2. Set `NODE_EXTRA_CA_CERTS` to the Zscaler CA path
3. Pencil HTTPS calls will succeed through the Zscaler intercept

Some organizations restrict outbound to specific destinations.
Required hosts for Pencil to fully function:

- `api.anthropic.com` (or your provider's equivalent)
- `pencil.dev` and `*.pencil.dev`
- `npmjs.com` (for `npm install`)
- `github.com` (for GitHub-Copilot provider; for `tokens-from` if
  surveying GitHub-hosted competitors)

If any of these are blocked, work with IT to allowlist the specific
hosts. Pencil doesn't need open egress; it needs specific hosts.

### 4. Verify the constrained setup

Run the verification command:

```bash
pencil run verify --constrained
```

This runs a sequence of checks:

1. ✅ `PENCIL_MODE=constrained` is set
2. ✅ A valid `PENCIL_LLM_PROVIDER` is configured
3. ✅ Provider credentials resolve
4. ✅ HTTPS to the provider's endpoint succeeds (with proxy if set)
5. ✅ A trivial LLM call returns a response (cost: < $0.01)
6. ✅ MCP server discovery is skipped (no MCP attempt)
7. ⚠️  Optional: third-party host reachability for `tokens-from`,
    `research`, `imagery-select` vendor lookups

Failures are surfaced with specific remediation:

```
❌ Step 4: HTTPS to Anthropic endpoint failed
   Error: connect ECONNREFUSED via http://corporate-proxy:8080

   Possible causes:
   - Proxy URL incorrect (verify with curl)
   - Proxy doesn't allow api.anthropic.com (request allowlist)
   - Proxy requires auth (set HTTPS_PROXY=http://user:pass@proxy:8080)

   Once resolved, re-run /product:design:run verify --constrained
```

## open-pencil — recommended companion in constrained environments

**open-pencil** (`brew install open-pencil` or
`npm install -g @open-pencil/cli`) is an MIT-licensed open-source
design tool that the suite uses for `.pen` ↔ `.fig` conversion,
structured token analysis, and design-layer linting. In constrained
environments, it's especially valuable because:

- **Fully offline.** No account, no server, no internet required.
  ~7MB Tauri desktop app or pure-CLI install.
- **Local-only execution.** Conversions, lints, and analyses run
  on your machine; nothing leaves the network.
- **Zero auth.** No API keys, no OAuth flows, no third-party
  service dependencies.
- **MIT-licensed.** Approved for restrictive procurement processes
  that prohibit some commercial dependencies.

For projects in constrained environments, open-pencil is the
recommended path for any operation that doesn't require LLM
generation. Specifically:

| Task                                 | With LLM provider | With open-pencil only (offline) |
| ------------------------------------ | ----------------- | ------------------------------- |
| Generate new `.pen` files            | Required          | Not possible                    |
| Convert `.pen` ↔ `.fig`              | Not needed        | Yes                             |
| Lint `.pen` files                    | Not needed        | Yes (color-contrast, etc.)      |
| Extract tokens from `.fig` / `.pen`  | Not needed        | Yes (analyze + variables)       |
| Render `.pen` to PNG/SVG             | Not needed        | Yes                             |
| Read / inspect document tree         | Not needed        | Yes (`open-pencil tree`)        |

This means a constrained-mode project can do design-system
**evolution** (adding new pages, components) only when LLM access
is configured, but **operations** on existing `.pen` files
(conversion, lint, analyze, render, diff) work fully offline.

For deeply restricted environments where even the LLM provider is
unreliable, open-pencil enables a triage workflow: develop new
designs locally with whatever LLM is available, then operate on
the resulting `.pen` files indefinitely without further network
access.

## What works in constrained mode

| Feature                       | Constrained mode? |
| ----------------------------- | ----------------- |
| `/product:strategy:scaffold`            | Yes (CLI path)    |
| `/product:design:design-page`         | Yes (CLI path)    |
| `/core:frameworks:heroui:build-components` | Yes (CLI + lints; no MCP introspection) |
| `/audit`               | Yes (file-based; lints fully)   |
| `/product:design:diff`                | Yes               |
| `/product:design:foundations:*`       | Yes               |
| `/product:design:patterns:*`          | Yes               |
| `/product:design:templates:*`         | Yes               |
| `/product:strategy:research`            | **Limited** — pattern detection requires headless browser; if outbound to competitor URLs blocked, falls back to user-provided screenshots |
| `/product:strategy:tokens-from <url>`   | Limited — same as research |
| `/product:strategy:tokens-from <screenshot>` | Yes — works fully offline |
| `/product:design:export --to figma`   | Limited — Figma API access depends on proxy allowlist |
| MCP-driven hot-reload         | No (MCP unavailable) |

## What degrades in constrained mode

- **Build feedback loops are slower.** Without MCP's
  `get_design_context` introspection, the build verifies via Pencil
  CLI screenshots, which is a few seconds per check vs. milliseconds
  via MCP. For a project with 50 components, full builds may take
  20% longer.
- **Some auto-fixes don't work.** Audit auto-fix on Plane 3
  (token mirroring) requires writing to `@theme` source CSS via
  the Pencil CLI's file API. Without MCP, the audit prints the
  required edit but doesn't apply it; the user runs the suggested
  command manually.
- **Research depth is reduced.** If competitor URL fetching is
  blocked, research falls back to "user provides screenshots
  manually" mode. The full URL-driven capture pipeline doesn't run.

## Workarounds for major missing capabilities

### When MCP is unavailable but you want hot-reload

Use Pencil CLI in watch mode + Storybook:

```bash
# Terminal 1
pencil watch design/heroui/components/buttons.pen --rebuild-on-change

# Terminal 2
npm run storybook
```

Pencil CLI's `watch` mode emits a `pencil-rebuild` event that
Storybook's HMR picks up. You get most of the MCP feedback loop
without MCP itself.

### When the LLM provider has a smaller token limit

Pencil's longer commands chunk automatically when
`PENCIL_PROVIDER_TOKEN_LIMIT` is set:

```bash
export PENCIL_PROVIDER_TOKEN_LIMIT=8000
```

Commands that would normally fit in one Anthropic 200K request get
broken into multiple smaller calls. This is slower (more round
trips) and slightly less coherent (each chunk re-establishes
context) but works.

### When third-party content fetching is blocked

For `tokens-from` and `research` against external sites, ask IT to
either:

1. **Allowlist** the specific competitor URLs your survey covers
2. **Provide an internal mirror** — many corporate networks have an
   internal sandboxed environment for third-party content
3. **Manual screenshot mode** — run `tokens-from <screenshot.png>`
   on screenshots IT downloads on your behalf

The `--screenshots <dir>` flag on `research` accepts a directory of
pre-downloaded screenshots, bypassing the browser-driven capture.

## CI in constrained mode

When CI runs in the same constrained environment:

1. Set `PENCIL_MODE=constrained` in the CI pipeline's environment
2. Provide LLM provider credentials via CI secrets (encrypted)
3. Configure the same proxy / CA bundle setup as developer machines
4. Run audit, diff, and lint-only operations in CI; reserve
   generative operations (build-components, design-page) for
   developer machines where iteration is faster

See `product/design/ci.md` for example CI workflows. The `audit` command in
constrained mode runs the same lint planes (1, 3) — those don't
require generative LLM calls and complete in seconds.

## Migration: leaving constrained mode

If your environment loosens (your org adds Anthropic to the approved
list, or you move to a less-restricted environment), simply unset
`PENCIL_MODE` and the LLM provider variables. Pencil resumes using
MCP / Anthropic direct on the next command run.

To verify you're back to default mode: `pencil run verify` (without
`--constrained`).
