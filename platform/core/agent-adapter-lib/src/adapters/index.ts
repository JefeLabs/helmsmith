/**
 * Adapter side-effect barrel.
 *
 * Importing this module runs every built-in adapter's module-level
 * `registerAdapter(...)` side-effect, populating the registry so `createAgent()`
 * can resolve any of the 11 `spec.type`s. The root `index.ts` imports this for
 * its side-effects; nothing here is re-exported (the public surface is
 * `createAgent`, not the adapter classes).
 */

import './bedrock-sdk/index.ts';
import './claude-agent-sdk/index.ts';
import './claude-code-cli/index.ts';
import './claude-sdk/index.ts';
import './codex-cli/index.ts';
import './copilot-cli/index.ts';
import './copilot-sdk/index.ts';
import './gemini-cli/index.ts';
import './gemini-sdk/index.ts';
import './openai-sdk/index.ts';
import './opencode-cli/index.ts';
