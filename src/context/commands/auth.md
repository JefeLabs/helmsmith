Auth

Arguments: $ARGUMENTS
Manage AI provider authentication for scoring and parsing.

Arguments: $ARGUMENTS (subcommand: login, status, switch, logout)

## Subcommands

### Login

Authenticate with an AI provider using OAuth:

```bash
npx taskmaster auth login --provider copilot
npx taskmaster auth login --provider openai
npx taskmaster auth login --provider anthropic
npx taskmaster auth login --provider copilot --force
```

- `--provider <name>`: copilot, openai, or anthropic
- `--force`: re-authenticate even if already logged in

### Status

Check authentication status for all providers:

```bash
npx taskmaster auth status
```

Shows which providers are authenticated, the active provider, and credential source.

### Switch

Change the active AI provider without re-authenticating:

```bash
npx taskmaster auth switch <provider>
```

### Logout

Revoke stored credentials for a provider:

```bash
npx taskmaster auth logout
npx taskmaster auth logout --provider openai
```

## Provider Notes

- **copilot**: GitHub Copilot subscription — supports env vars (GITHUB_TOKEN, GH_TOKEN)
- **openai**: OpenAI ChatGPT subscription — OAuth PKCE with localhost callback
- **anthropic**: Anthropic Claude subscription — OAuth PKCE with copy-paste flow
