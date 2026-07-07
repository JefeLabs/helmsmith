/**
 * Job event bus + the harness-side adapter-event vocabulary.
 *
 * The new `@helmsmith/agent-adapter` surface has no event bus — adapters expose
 * `invoke()`/`stream()` instead. The harness, however, still multiplexes a
 * normalized, JSON-serializable event stream per job to its consumers (the TUI
 * events column, SSE bridges, the TokenAccumulator). That vocabulary lives here
 * now: the orchestrator SYNTHESIZES these events around each `adapter.invoke()`
 * call (see orchestrator.ts) rather than bridging an adapter's own event source.
 *
 * `AdapterEvent` / `AdapterEventSource` / `AdapterEventBus` are retained (moved
 * out of the old adapter lib) so the bus envelope, the bridge helper, and every
 * downstream consumer keep their existing shapes — only the PRODUCER changed.
 */

/**
 * Per-invocation token usage, in the harness event vocabulary (provider-style
 * prompt/completion names). Distinct from the adapter lib's `TokenUsage`
 * (input/output names); the orchestrator maps between them when it synthesizes
 * a `response` event from an `AgentInvocationResult`.
 */
export interface EventTokenUsage {
  /** Tokens in the prompt sent to the model. */
  promptTokens?: number;
  /** Tokens generated in the completion. */
  completionTokens?: number;
  /** promptTokens + completionTokens. Some providers only report this. */
  totalTokens?: number;
}

/**
 * The structured event types the harness surfaces per job. Consumers (TUI,
 * SSE, TokenAccumulator) subscribe via the JobBus; the shape stays flat and
 * JSON-serializable so any subscriber can render it without adapter-specific
 * knowledge.
 */
export type AdapterEvent =
  | {
      kind: 'request';
      ts: string;
      system?: string;
      user: string;
      model: string;
      provider?: string;
    }
  | {
      kind: 'response';
      ts: string;
      text: string;
      raw?: unknown;
      /** Token usage for this invoke, when the adapter reports it. */
      usage?: EventTokenUsage;
    }
  | {
      kind: 'error';
      ts: string;
      message: string;
      cause?: unknown;
    }
  | {
      // Loader (context-loader-cli) progress event, bridged onto the JobBus
      // when a job's "agent" is actually an ingestion worker.
      kind: 'loader-event';
      ts: string;
      counts: {
        files: number;
        chunks: number;
        nodes: number;
        edges: number;
        vectors: number;
        errors: number;
      };
      lastItem?: string;
      innerKind: string;
    };

/** A subscribable source of `AdapterEvent`s. */
export interface AdapterEventSource {
  subscribe(handler: (event: AdapterEvent) => void): () => void;
}

/**
 * Minimal in-memory event bus. No longer produced by adapters; retained for
 * the `bridgeAdapter` helper and as a test fixture for event-stream wiring.
 * Throw-isolated: one subscriber's failure never breaks delivery to others.
 */
export class AdapterEventBus implements AdapterEventSource {
  private readonly handlers = new Set<(event: AdapterEvent) => void>();

  subscribe(handler: (event: AdapterEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: AdapterEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // One subscriber's failure must not stop delivery to others.
      }
    }
  }
}

/**
 * Job-scoped envelope wrapping an adapter event with the {jobId, agentId} that
 * produced it. External consumers (TUI, web UI, future audit pipeline) see this
 * shape — they never talk to adapters directly.
 */
export interface Envelope {
  jobId: string;
  agentId: string;
  event: AdapterEvent;
}

/**
 * In-memory pub/sub multiplexer. The harness-server owns one of these and the
 * orchestrator publishes synthesized adapter events into it per agent run.
 * Subscribers attach by jobId; events from other jobs never reach them.
 *
 * Throw isolation: one consumer's failure cannot break delivery to others or
 * propagate back to the producing path.
 */
export class JobBus {
  private readonly handlers = new Map<string, Set<(env: Envelope) => void>>();

  publish(jobId: string, agentId: string, event: AdapterEvent): void {
    const set = this.handlers.get(jobId);
    if (!set) return;
    const envelope: Envelope = { jobId, agentId, event };
    for (const handler of set) {
      try {
        handler(envelope);
      } catch {
        // Isolated; producer (and other consumers) keep going.
      }
    }
  }

  subscribe(jobId: string, handler: (env: Envelope) => void): () => void {
    let set = this.handlers.get(jobId);
    if (!set) {
      set = new Set();
      this.handlers.set(jobId, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(jobId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(jobId);
    };
  }

  subscriberCount(jobId: string): number {
    return this.handlers.get(jobId)?.size ?? 0;
  }
}

/**
 * Subscribe to an `AdapterEventSource` and re-publish each event onto the job
 * bus tagged with `{jobId, agentId}`. Returns an unsubscribe function that
 * detaches the bridge.
 *
 * Retained for consumers that drive their own `AdapterEventSource` (e.g.
 * loader workers bridging IngestionEvents). The orchestrator no longer uses it
 * for agent adapters — it publishes synthesized events directly.
 */
export function bridgeAdapter(
  bus: JobBus,
  jobId: string,
  agentId: string,
  source: AdapterEventSource,
): () => void {
  return source.subscribe((event) => {
    bus.publish(jobId, agentId, event);
  });
}
