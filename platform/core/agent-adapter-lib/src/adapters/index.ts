/**
 * Adapter barrel — INTERIM.
 *
 * Deleted in the cutover; exists only so the tree stays green while adapters
 * are converted to explicit registrars. Nothing should start depending on it.
 */

import { registerBedrockSdk } from './bedrock-sdk/index.ts';
import { registerClaudeAgentSdk } from './claude-agent-sdk/index.ts';
import { registerClaudeCodeCli } from './claude-code-cli/index.ts';
import { registerClaudeSdk } from './claude-sdk/index.ts';
import { registerCodexCli } from './codex-cli/index.ts';
import { registerCopilotCli } from './copilot-cli/index.ts';
import { registerCopilotSdk } from './copilot-sdk/index.ts';
import { registerGeminiCli } from './gemini-cli/index.ts';
import { registerGeminiSdk } from './gemini-sdk/index.ts';
import { registerOpenAiSdk } from './openai-sdk/index.ts';
import { registerOpenCodeCli } from './opencode-cli/index.ts';

registerClaudeSdk();
registerClaudeAgentSdk();
registerClaudeCodeCli();
registerOpenCodeCli();
registerCopilotSdk();
registerCopilotCli();
registerGeminiCli();
registerGeminiSdk();
registerOpenAiSdk();
registerCodexCli();
registerBedrockSdk();
