import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '@helmsmith/agent-adapter';
import { bridgeBroker, FileBroker } from '@helmsmith/agent-auth';

const authPath = join(homedir(), '.agentx', 'auth.json');

const broker = new FileBroker(authPath);

const adapter = createAgent({
  spec: {
    type: 'opencode-cli',
    // Override these if your local opencode lives elsewhere or expects a different model:
    // binaryPath: '/usr/local/bin/opencode',
    model: 'anthropic/claude-opus-4-7',
  },
  workdir: process.cwd(),
  credentialBroker: bridgeBroker(broker),
});

const result = await adapter.invoke({
  messages: [{ role: 'user', content: 'Reply with exactly the word "hello".' }],
});
console.log('OpenCode said:', result.content.trim());
