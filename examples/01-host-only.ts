import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '@helmsmith/agent-adapter';
import { bridgeBroker, FileBroker } from '@helmsmith/agent-auth';

const authPath = join(homedir(), '.agentx', 'auth.json');

const broker = new FileBroker(authPath);
const adapter = createAgent({
  spec: { type: 'claude-sdk', model: 'claude-opus-4-7' },
  workdir: process.cwd(),
  credentialBroker: bridgeBroker(broker),
});

const result = await adapter.invoke({
  messages: [{ role: 'user', content: 'Reply with exactly the word "hello".' }],
});
console.log('Claude SDK said:', result.content);
