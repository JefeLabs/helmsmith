import type { AdapterEventSource } from './events.js';

export interface InvocationSpec {
  system?: string;
  user: string;
}

export interface AgentAdapter {
  readonly events: AdapterEventSource;
  invoke(spec: InvocationSpec): Promise<string>;
}
