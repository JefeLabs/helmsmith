# Getting Started — Team Mode

Team mode runs the skillzkit catalog as a centrally-deployed REST API,
hosted alongside your AgentX controlplane. Each team member's CLI/TUI
fetches from the shared API; new contributions are submitted via API
and validated server-side.

This guide covers both halves of the setup:

1. **Operator setup** — deploy the skillzkit API (Docker against
   controlplane, or AWS Lambda) and configure storage + optional
   review.
2. **End-user setup** — connect the CLI/TUI on a developer's machine
   to the team's API.

If you just want to use a catalog locally without the team
infrastructure, see
[getting-started-standalone-mode.md](getting-started-standalone-mode.md)
instead.

---

## Part 1 — Operator: deploy the API

### 1.1 Pick a deployment target

| Target | Best for | Storage typically |
|---|---|---|
| **Docker alongside controlplane** | Most teams. Runs as a sibling service in your existing controlplane docker-compose. | `fs-persistent:/data` (Docker volume) |
| **AWS Lambda** | Teams already on AWS. Stateless, auto-scaling. | `s3:<bucket-name>` |

Both options use the same Hono app — just different runtime adapters.

### 1.2 Docker against controlplane (recommended)

In your `agentx-platform/controlplane/compose.yaml` (or equivalent):

```yaml
services:
  controlplane:
    image: agentx/controlplane:latest
    environment:
      # so controlplane's UI can render skillzkit links
      SKILLZKIT_API_URL: http://skillzkit-api:3000

  skillzkit-api:
    build: ../../agentx-toolbox/apps/skillzkit
    # OR use a published image:
    # image: agentx/skillzkit-api:latest
    environment:
      SKILLZKIT_STORAGE: fs-persistent:/data
      PORT: "3000"
      # Optional: enable layer-3 agent review
      # SKILLZKIT_REVIEW_AGENT: enabled
    volumes:
      - skillz-data:/data
    networks:
      - controlplane
    ports:
      - "3000:3000"  # remove if you only want internal access
                     # via controlplane reverse proxy

volumes:
  skillz-data:

networks:
  controlplane:
```

Bring it up:

```bash
docker compose up -d skillzkit-api
docker compose logs skillzkit-api
# skillzkit-api listening on :3000  (storage=fs-persistent:/data, writable=true)
```

Verify:

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","version":"0.1.0",...,"writable":true}
```

### 1.3 AWS Lambda

A working SAM template is committed at
[`deploys/lambda/template.yaml`](../deploys/lambda/template.yaml).
Quick deploy:

```bash
cd apps/skillzkit
npm run build:lambda
sam build --template deploys/lambda/template.yaml
sam deploy --guided
```

The full walkthrough — including IAM policies, CDK and Terraform
alternatives, monitoring, cost estimates, custom domain setup, and
troubleshooting — is in
[deploy-aws-lambda.md](deploy-aws-lambda.md). Read that for a
production deploy.

### 1.4 Configure storage

Storage is selected entirely via `SKILLZKIT_STORAGE`:

```
fs-persistent:/data       # Docker volume — recommended for Docker hosting
s3:bucket-name            # AWS S3 — recommended for Lambda
memory                    # Ephemeral — tests only
```

For Docker hosting with `fs-persistent`, ensure the volume is backed
up (catalog data lives there).

### 1.5 (Optional) Enable agent review

Layer-3 review uses an LLM to evaluate quality, tag-fit, and safety
before contributions are eligible for promotion. Disabled by default.

To enable, set:

```
SKILLZKIT_REVIEW_AGENT=enabled
```

The skillzkit API doesn't hold provider credentials directly. It uses
`@ecruz165/agent-adapter` to invoke whichever LLM the host's
`BindingResolver` (from `@ecruz165/agent-auth`) is configured to use.
That means controlplane decides whether reviews go to Claude, OpenAI,
local Qwen, etc. — and switching providers doesn't require a skillzkit
deploy.

When enabled, the contribute flow becomes async:

- `POST /contributions` → 202 Accepted + `Location` header
- Background review runs (~5–10s)
- Status is queryable via `GET /contributions/:id`

When disabled, contributions go straight to "stored" on validation
pass (synchronous 201 response).

### 1.6 (Optional) Reverse-proxy through controlplane

If you don't want the skillzkit API exposed directly, reverse-proxy
`/api/skillz/*` from controlplane to the skillzkit container:

```nginx
# (sketch — adapt to your reverse-proxy config)
location /api/skillz/ {
    proxy_pass http://skillzkit-api:3000/api/v1/;
    proxy_set_header Authorization $http_authorization;
}
```

End users then point their CLI at `https://controlplane.example.com/api/skillz`
instead of the skillzkit container directly.

### 1.7 Issue API keys to team members

API key issuance lives in the agentx-controlplane UI — the skillzkit
API doesn't manage keys itself. Once a team member signs in to
controlplane, they generate a key from the controlplane UI and use it
in `skillzkit init` (see Part 2 below).

If you're running a smaller setup without controlplane, you can mint
keys via whatever mechanism your platform provides. The skillzkit API
expects an opaque bearer token; the verification path is configured
on the host.

---

## Part 2 — End user: connect to the team API

### 2.1 Install the CLI

```bash
npm install -g @ecruz165/skillzkit
```

(Same install as standalone mode.)

### 2.2 Get an API key from controlplane

In your team's controlplane UI:

1. Sign in
2. Navigate to API Keys (location varies by deploy)
3. Generate a new key — give it a memorable name (e.g., your laptop)
4. **Copy the key immediately** — most controlplane UIs show it once

The key is opaque to skillzkit. It'll look something like
`skz_live_…` or whatever format your controlplane uses.

### 2.3 Run init in team mode

Two paths — interactive or args.

**Interactive** (recommended for first run):

```bash
skillzkit init
```

Walk through the prompts:

```
Mode? (1) standalone — use bundled skills  (2) team — connect to a shared API: 2
Email: you@example.com
API URL (e.g. https://skillz.example.com): https://controlplane.example.com/api/skillz
API key (from agentx-controlplane): ********************
PIN (min 6 chars, used to encrypt key at rest): ******

✓ Created /Users/you/.agentx/skillzkit/config.json

Mode: team
API:  https://controlplane.example.com/api/skillz
Key:  ...4f92  (encrypted at rest)

Next:
  skillzkit ui                    — browse the team catalog
  skillzkit config                — view current configuration
```

**Args mode** (for scripts / CI):

```bash
skillzkit init \
  --mode team \
  --email you@example.com \
  --api-url https://controlplane.example.com/api/skillz \
  --api-key $SKILLZKIT_KEY \
  --pin $SKILLZKIT_PIN \
  --force
```

### 2.4 Understand what got stored

```bash
skillzkit config
```

Shows:

```
mode       = team
email      = you@example.com
team.apiUrl    = https://...
team.keyMasked = ...4f92
```

The API key is **encrypted** in `~/.agentx/skillzkit/config.json` —
the stored form is AES-256-GCM ciphertext keyed by your email + PIN.
Even with read access to your home directory, an attacker can't use
the key without your PIN.

To inspect the encrypted blob (without revealing plaintext):

```bash
skillzkit config --show-secrets
# (still doesn't show plaintext key — only the encrypted blob's
# bookkeeping fields: salt, iv, kdf params, etc.)
```

### 2.5 Browse the team catalog

```bash
skillzkit ui
# Loading catalog from https://controlplane.example.com/api/skillz...
# (TUI launches with the team's catalog loaded)
```

Or via CLI:

```bash
skillzkit list
skillzkit search migration
skillzkit show core:tools:biome
```

CLI commands work the same as standalone mode — the network round-trip
is transparent.

### 2.6 Install team artifacts into a project

```bash
cd /path/to/your/project
skillzkit install product:strategy:scaffold
```

Install always writes locally into your project's `.claude/`
directory. The team catalog is the source; your project gets the
files copied in.

### 2.7 Contribute a new artifact (when ready)

The contribute CLI subcommand ships in v0.2. The flow will be:

```bash
skillzkit contribute --kind command --slug product:strategy:my-thing \
  --file ./my-thing.md
# → server validates structurally + scans bundle
# → if review enabled: kicks off async LLM review
# → returns the contribution ID + status URL
# → poll: skillzkit contribute --status <id>
```

You'll be prompted for your PIN — needed to decrypt the API key for
the POST. The decrypted key is held in memory only for the duration of
the request and discarded immediately.

For now, contribute via the existing skillzkit repo (PR flow).

### 2.8 Update a contribution

After you've published `product:strategy:my-thing` once, you own the
slug. To publish a new version:

```bash
skillzkit contribute --kind command --slug product:strategy:my-thing \
  --file ./my-thing.md \
  --version-bump minor
```

Author-match-on-update enforces this server-side: only the original
publisher (matched by stable author ID, not display name) can publish
new versions of an existing slug. A different author trying to use a
taken slug is rejected with a clear error pointing to the owner.

---

## Common operator tasks

### Promote a contribution

After review passes (or immediately if review is disabled), the
artifact is `accepted` but not `live` — the catalog index still points
at the previous version. Promotion is explicit:

```bash
# (admin/maintainer flow, via API)
curl -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  https://your-skillzkit-api/api/v1/contributions/<id>/promote
```

The next `GET /catalog` reflects the new version. Old versions remain
addressable for rollback.

### Roll back to a previous version

Promote an older version:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  https://your-skillzkit-api/api/v1/contributions/<earlier-id>/promote
```

The index pointer moves; the artifacts themselves are immutable.

### Audit who contributed what

```bash
# (read endpoint, public or admin depending on your auth config)
curl https://your-skillzkit-api/api/v1/contributions?author=<id>
```

(Endpoint coming in v0.2.)

### Backup the catalog

For `fs-persistent` storage, back up the Docker volume:

```bash
docker run --rm -v skillz-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/skillz-$(date +%F).tar.gz -C /data .
```

For `s3` storage, enable bucket versioning + lifecycle rules.

### Migrate from one storage backend to another

Use `skillzkit serve` against the source backend, point a temporary
client at it, fetch the full catalog, then re-write into the
destination backend. Migration tooling will land in v0.2.

---

## Troubleshooting

### "Could not load catalog from <apiUrl>"

The TUI / CLI exits with this on launch when the API is unreachable.
Causes:

- API URL typo → fix with `skillzkit config apiUrl https://new-url`
- API container down → check `docker compose ps`
- Network firewall → check connectivity from your machine: `curl <apiUrl>/api/v1/health`

### "Could not decrypt API key"

You entered the wrong PIN. The decryption uses email + PIN as a
combined passphrase — both must match what was stored at init time.
If you've changed your email locally, the encrypted key is
unrecoverable; run `skillzkit init --force` and re-enter the API key.

### "401 Unauthorized" on contribute

Either:

- API key is wrong / revoked / expired → generate a new one from
  controlplane, run `skillzkit init --force` to re-store
- The bearer token format expected by the server differs from what
  controlplane mints → check the host's auth config

### Server returns 422 with structural findings

Contribution failed layer 1 or layer 2 validation. The response
includes specific findings (bad slug format, missing frontmatter
field, unsafe path, etc.). Fix the issues locally and resubmit.

### Server returns 422 with safety findings

Layer 3 (agent review) flagged content as unsafe — most commonly
hardcoded secrets the structural pass missed, or prompt-injection
patterns. Inspect the findings, fix the issue, resubmit.

### Server review is taking too long

Layer 3 reviews typically complete in 5–10s. If your review consistently
takes longer:

- Check the configured LLM provider's latency
- Consider switching to a faster local model (Qwen 4B / 8B) for
  cost-sensitive deploys
- Bump the timeout in `lib/api/validation/reviewer.ts`'s
  `AgentAdapterReviewer` constructor (or wrap with your own
  reviewer that has a different timeout)

---

## Where to go from here

- **[architecture.md](architecture.md)** — deep-dive into how the
  components fit together, why specific design choices were made.
- **[feature-overview.md](feature-overview.md)** — full categorized
  list of capabilities.
- **[executive-overview.md](executive-overview.md)** — non-technical
  framing for stakeholders.
