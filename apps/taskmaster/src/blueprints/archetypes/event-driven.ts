import type { ApplicationBlueprint } from '../types.js';

export const EVENT_DRIVEN_BLUEPRINT: ApplicationBlueprint = {
  id: 'event-driven',
  name: 'Event-Driven Service',
  description:
    'Service built around asynchronous message processing with reliable delivery, idempotent consumers, and dead-letter handling for failed messages.',
  appType: 'service',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'message-broker',
      question: 'Which message broker will be used?',
      type: 'single-select',
      options: ['rabbitmq', 'kafka', 'sqs', 'redis', 'nats'],
      default: 'rabbitmq',
    },
    {
      id: 'ordering-required',
      question: 'Is strict message ordering required?',
      type: 'boolean',
      default: false,
    },
    {
      id: 'replay-needed',
      question: 'Do you need the ability to replay past events?',
      type: 'boolean',
      default: false,
    },
    {
      id: 'consumer-groups',
      question: 'Will multiple consumer groups process the same events?',
      type: 'boolean',
      default: false,
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'idempotency-handling',
      title: 'Idempotency handling',
      description:
        'Ensure that processing the same message more than once produces the same result, preventing duplicate side effects from at-least-once delivery.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 6,
      requiredSkills: ['backend', 'messaging'],
      tags: ['concern:reliability', 'layer:consumer'],
      implementationGuidance:
        'Store a hash or unique message ID in a deduplication table before processing. Check for existence on each delivery and skip already-processed messages. Use database transactions to make the dedup check and business operation atomic.',
    },
    {
      id: 'dead-letter-queue',
      title: 'Dead-letter queue',
      description:
        'Route messages that cannot be processed after repeated attempts to a dead-letter queue for inspection, alerting, and manual reprocessing.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'messaging'],
      tags: ['concern:reliability', 'layer:infra'],
      implementationGuidance:
        'Configure a DLQ on the broker with a max retry count (typically 3-5 attempts). Log full message context when routing to the DLQ. Build a simple admin interface or CLI command to inspect, requeue, or discard dead-lettered messages.',
    },
    {
      id: 'correlation-ids',
      title: 'Correlation IDs',
      description:
        'Propagate a unique correlation identifier through all messages in an event chain so that the full processing lineage can be traced end-to-end.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:consumer'],
      implementationGuidance:
        'Extract or generate a correlation ID from the message headers on ingestion. Store it in async local storage and attach it to all outbound messages, logs, and downstream API calls. Use a consistent header name (e.g., X-Correlation-ID) across services.',
    },
    {
      id: 'graceful-consumer-shutdown',
      title: 'Graceful consumer shutdown',
      description:
        'Handle shutdown signals by finishing in-flight messages, stopping new message consumption, and cleanly disconnecting from the broker before exiting.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:reliability', 'layer:infra'],
      implementationGuidance:
        'Register SIGTERM and SIGINT handlers that pause the consumer, wait for in-flight messages to finish processing (with a configurable timeout), then close broker connections and flush logs. Nack unprocessed messages so they return to the queue for other consumers.',
    },
    {
      id: 'error-handling',
      title: 'Error handling',
      description:
        'Classify consumer errors into transient (retriable) and permanent (dead-letter) categories, applying the appropriate recovery strategy for each.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:error-handling', 'layer:consumer'],
      implementationGuidance:
        'Create a typed error hierarchy that distinguishes transient errors (network timeouts, temporary unavailability) from permanent errors (malformed payload, business rule violation). Route transient errors to retry with exponential backoff; route permanent errors directly to the DLQ.',
    },
    {
      id: 'structured-logging',
      title: 'Structured logging',
      description:
        'Emit structured log entries with message metadata (queue, message ID, correlation ID, attempt count) for searchable observability across all consumers.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Use a JSON logger (e.g., pino) and enrich every log entry with the message ID, queue name, correlation ID, and retry attempt number. Log at info level for successful processing, warn for retries, and error for DLQ routing. Include processing duration for performance monitoring.',
    },

    // PATTERN-FIRST
    {
      id: 'poison-message-handling',
      title: 'Poison message handling',
      description:
        'Detect messages that consistently crash consumers and quarantine them before they can cause repeated restarts or block queue processing.',
      category: 'reliability',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'messaging'],
      tags: ['concern:reliability', 'layer:consumer'],
      implementationGuidance:
        'Track per-message failure counts using delivery metadata or an external counter. When a message exceeds the poison threshold, route it to a quarantine queue or DLQ without further retry attempts. Alert operations when poison messages are detected.',
    },
    {
      id: 'schema-validation',
      title: 'Message schema validation',
      description:
        'Validate incoming message payloads against a defined schema at the consumer boundary, rejecting malformed messages before business logic execution.',
      category: 'data-integrity',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend'],
      tags: ['concern:data-integrity', 'layer:consumer'],
      implementationGuidance:
        'Define message schemas using Zod, JSON Schema, or Avro. Validate each message immediately after deserialization. Route schema-invalid messages to the DLQ with a descriptive validation error rather than retrying them, since they will never pass validation.',
    },
    {
      id: 'backpressure',
      title: 'Backpressure management',
      description:
        'Control the rate of message consumption to prevent overwhelming downstream services or exhausting local resources during traffic spikes.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'performance'],
      tags: ['concern:performance', 'layer:consumer'],
      implementationGuidance:
        'Use prefetch limits (RabbitMQ) or consumer fetch sizes (Kafka) to cap the number of in-flight messages. Monitor downstream response times and reduce the prefetch dynamically if latency increases. Consider a local bounded queue that applies back-pressure to the broker connection.',
    },
    {
      id: 'retry-strategy',
      title: 'Retry strategy',
      description:
        'Implement a structured retry policy with exponential backoff and jitter for transient failures, preventing retry storms and thundering herds.',
      category: 'reliability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend'],
      tags: ['concern:reliability', 'layer:consumer'],
      implementationGuidance:
        'Use exponential backoff with jitter (e.g., base delay * 2^attempt + random jitter) for transient errors. Set a max retry count (3-5) before routing to the DLQ. If the broker supports delayed redelivery natively, use that; otherwise, use a delay queue pattern with per-attempt TTLs.',
    },
    {
      id: 'consumer-health',
      title: 'Consumer health checks',
      description:
        'Monitor the health of consumer connections and processing loops, exposing liveness and readiness signals for orchestration platforms.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Expose a health endpoint that reports consumer connection status and last-processed timestamp. Mark the service as unhealthy if the consumer disconnects or if no messages are processed within an expected interval. Integrate with Kubernetes liveness and readiness probes.',
    },
    {
      id: 'message-tracing',
      title: 'Message tracing',
      description:
        'Track the full lifecycle of each message from publication through consumption, including processing time, retries, and outcome, for debugging and auditing.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'observability'],
      tags: ['concern:observability', 'layer:consumer'],
      implementationGuidance:
        'Emit trace spans for each message processing step using OpenTelemetry or a similar framework. Include the message ID, queue name, and correlation ID in span attributes. Propagate trace context through message headers so that publisher and consumer spans are linked.',
    },
    {
      id: 'monitoring',
      title: 'Queue monitoring and alerting',
      description:
        'Track queue depth, consumer lag, processing rates, and error rates, triggering alerts when metrics breach operational thresholds.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Collect metrics on queue depth, messages processed per second, error rate, and consumer lag. Expose them via a /metrics endpoint or push to a monitoring backend. Set alerts for growing queue depth (consumer falling behind), high error rate, and consumer disconnections.',
    },

    // DEFERRED
    {
      id: 'saga-pattern',
      title: 'Saga orchestration',
      description:
        'Coordinate multi-step business transactions across services using a saga pattern with compensating actions for partial failure recovery.',
      category: 'architecture',
      urgency: 'deferred',
      estimatedComplexity: 8,
      requiredSkills: ['backend', 'architecture'],
      tags: ['concern:architecture', 'layer:service'],
      implementationGuidance:
        'Implement either a choreography-based saga (each service publishes events and listens for others) or an orchestrator-based saga (a central coordinator drives the steps). Define compensating actions for each step to undo partial work on failure. Persist saga state so it survives process restarts.',
    },
    {
      id: 'event-sourcing',
      title: 'Event sourcing',
      description:
        'Store state changes as an immutable sequence of events rather than mutable records, enabling full audit trails and temporal queries.',
      category: 'architecture',
      urgency: 'deferred',
      estimatedComplexity: 8,
      requiredSkills: ['backend', 'architecture', 'database'],
      tags: ['concern:architecture', 'layer:data'],
      implementationGuidance:
        'Persist every state change as an append-only event in an event store. Rebuild current state by replaying events from the beginning or from a snapshot. Build read-optimized projections from the event stream for query use cases. Plan for event schema evolution using upcasting or versioned event types.',
    },
    {
      id: 'consumer-scaling',
      title: 'Consumer scaling',
      description:
        'Enable horizontal scaling of consumers to handle increased message throughput while maintaining processing guarantees and balanced load distribution.',
      category: 'performance',
      urgency: 'deferred',
      estimatedComplexity: 6,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:performance', 'layer:infra'],
      implementationGuidance:
        'Use consumer groups (Kafka) or competing consumers (RabbitMQ) to distribute load across instances. Ensure idempotency so duplicate delivery during rebalancing is safe. Monitor consumer lag per partition or queue to trigger autoscaling. Test rebalancing behavior to verify no messages are lost.',
    },
    {
      id: 'message-versioning',
      title: 'Message versioning',
      description:
        'Version message schemas so that producers and consumers can evolve independently without breaking compatibility across deployments.',
      category: 'data-integrity',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'architecture'],
      tags: ['concern:data-integrity', 'layer:consumer'],
      implementationGuidance:
        'Include a version field in every message envelope. Consumers should handle multiple versions using version-specific deserializers or an upcasting chain that transforms old formats to the latest. Validate backward compatibility when adding new message versions. Consider a schema registry for centralized version management.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'ordering-required',
      answerEquals: true,
      addConcerns: ['backpressure'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'replay-needed',
      answerEquals: true,
      addConcerns: ['event-sourcing'],
      promoteToUrgency: 'pattern-first',
    },
    {
      questionId: 'consumer-groups',
      answerEquals: true,
      addConcerns: ['consumer-scaling'],
      promoteToUrgency: 'pattern-first',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'idempotency-handling',
    'dead-letter-queue',
    'correlation-ids',
    'graceful-consumer-shutdown',
    'error-handling',
    'structured-logging',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['message-queue', 'event-bus', 'pub-sub'],
    frameworks: ['framework:bullmq', 'framework:kafkajs'],
    capabilities: [],
    fileIndicators: ['consumers/', 'handlers/', 'events/', 'subscribers/'],
    weight: 0.8,
  },
};
