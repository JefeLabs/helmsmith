import type { ApplicationBlueprint } from '../types.js';

export const REST_API_BLUEPRINT: ApplicationBlueprint = {
  id: 'rest-api',
  name: 'REST API Service',
  description:
    'Backend service exposing RESTful endpoints with structured error handling, authentication, and observability',
  appType: 'service',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'internet-facing',
      question: 'Is this service internet-facing?',
      type: 'boolean',
      default: true,
    },
    {
      id: 'auth-strategy',
      question: 'What authentication strategy will be used?',
      type: 'single-select',
      options: ['jwt', 'session', 'api-key', 'oauth2', 'none'],
      default: 'jwt',
    },
    {
      id: 'database',
      question: 'What database will be used?',
      type: 'single-select',
      options: ['postgres', 'mysql', 'mongodb', 'sqlite', 'none'],
      default: 'postgres',
    },
    {
      id: 'multi-tenant',
      question: 'Is this a multi-tenant service?',
      type: 'boolean',
      default: false,
    },
    {
      id: 'api-versioning',
      question: 'Do you need API versioning?',
      type: 'boolean',
      default: false,
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'input-validation',
      title: 'Input validation',
      description:
        'Validate all incoming request payloads, query parameters, and path parameters against defined schemas before they reach business logic.',
      category: 'security',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'security'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Use a schema validation library (e.g., Zod, Joi, or AJV) at the middleware layer. Define request schemas per route and reject malformed input with 400 responses before it reaches service code.',
    },
    {
      id: 'error-handling',
      title: 'Structured error responses',
      description:
        'Return consistent, machine-readable error payloads across all endpoints with appropriate HTTP status codes and error classification.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:error-handling', 'layer:api'],
      implementationGuidance:
        'Create a centralized error handler middleware that catches all thrown errors and maps them to a standard envelope: { error: { code, message, details? } }. Define domain error classes that carry status codes and error codes.',
    },
    {
      id: 'auth-middleware',
      title: 'Authentication middleware',
      description:
        'Enforce identity verification on protected routes, extracting and validating credentials from request headers or cookies.',
      category: 'security',
      urgency: 'upfront',
      estimatedComplexity: 6,
      requiredSkills: ['backend', 'security'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Implement an authentication middleware that runs before route handlers. Support the chosen strategy (JWT verification, session lookup, API key validation, or OAuth2 token introspection). Attach the authenticated identity to the request context for downstream use.',
    },
    {
      id: 'health-check',
      title: 'Health check endpoint',
      description:
        'Expose a lightweight endpoint that reports service liveness and readiness, including downstream dependency status.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 2,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:api'],
      implementationGuidance:
        'Add GET /health (liveness) and GET /ready (readiness) endpoints. The liveness check returns 200 if the process is running. The readiness check verifies database connectivity and other critical dependencies before returning 200.',
    },
    {
      id: 'structured-logging',
      title: 'Structured logging',
      description:
        'Emit log entries as structured JSON with consistent fields (timestamp, level, correlation ID, service name) for machine parsing and aggregation.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Use a structured logger (e.g., pino, winston with JSON transport) configured at startup. Attach request-scoped context (correlation ID, user ID) via async local storage or middleware. Log at appropriate levels: error for failures, warn for degraded paths, info for request lifecycle.',
    },
    {
      id: 'graceful-shutdown',
      title: 'Graceful shutdown',
      description:
        'Handle SIGTERM and SIGINT signals by draining in-flight requests, closing database connections, and flushing logs before process exit.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:reliability', 'layer:infra'],
      implementationGuidance:
        'Register signal handlers for SIGTERM and SIGINT. On signal: stop accepting new connections, wait for in-flight requests to complete (with a timeout), close database pools, flush log buffers, then exit with code 0. Use a shutdown manager that orchestrates teardown order.',
    },
    {
      id: 'env-config',
      title: 'Environment configuration',
      description:
        'Load and validate configuration from environment variables with sensible defaults, type coercion, and fail-fast on missing required values.',
      category: 'config-management',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:config-management', 'layer:infra'],
      implementationGuidance:
        'Create a config module that reads from process.env, applies defaults, and validates with a schema. Fail fast at startup if required variables are missing. Group config by domain (server, database, auth, logging). Never log sensitive values.',
    },

    // PATTERN-FIRST
    {
      id: 'rate-limiting',
      title: 'Rate limiting',
      description:
        'Throttle incoming requests per client or IP to prevent abuse, protect downstream resources, and ensure fair usage across consumers.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'security'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Apply rate limiting middleware using a sliding window or token bucket algorithm. Use an in-memory store for single-instance deployments and Redis for distributed setups. Return 429 Too Many Requests with Retry-After header when limits are exceeded. Configure different limits per route or authentication tier.',
    },
    {
      id: 'request-correlation',
      title: 'Request correlation IDs',
      description:
        'Assign a unique identifier to each incoming request and propagate it through all downstream calls, logs, and error responses for end-to-end traceability.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:api'],
      implementationGuidance:
        'Add middleware that reads X-Request-ID from incoming headers or generates a UUID if absent. Store the ID in async local storage so all downstream log calls and outbound requests include it automatically. Return the correlation ID in response headers.',
    },
    {
      id: 'caching-strategy',
      title: 'Caching strategy',
      description:
        'Reduce latency and database load by caching frequently accessed, rarely changing data at the appropriate layer (in-memory, Redis, or HTTP cache headers).',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'performance'],
      tags: ['concern:performance', 'layer:service'],
      implementationGuidance:
        'Identify hot read paths and apply caching at the service layer. Use Cache-Control headers for client-side caching of stable resources. For server-side caching, use an LRU in-memory cache for single-instance or Redis for distributed. Implement cache invalidation on writes and set appropriate TTLs.',
    },
    {
      id: 'db-migrations',
      title: 'Database migrations',
      description:
        'Manage database schema changes as versioned, repeatable migration scripts that can be applied and rolled back in any environment.',
      category: 'data',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'database'],
      tags: ['concern:data', 'layer:data'],
      implementationGuidance:
        'Use a migration tool appropriate to your database (e.g., Knex migrations, Prisma Migrate, TypeORM migrations). Store migration files in version control. Run migrations as part of the deployment pipeline, never on application startup in production. Include both up and down migration steps.',
    },
    {
      id: 'test-infrastructure',
      title: 'Test infrastructure',
      description:
        'Establish testing patterns and tooling for unit, integration, and API-level tests with isolated test databases and fixture management.',
      category: 'testing',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'testing'],
      tags: ['concern:testing', 'layer:tests'],
      implementationGuidance:
        'Set up a test runner (e.g., Vitest, Jest) with separate config for unit and integration tests. Create test database setup/teardown helpers. Use factories or fixtures for test data. Mock external services at the HTTP boundary. Establish coverage thresholds and integrate with CI.',
    },
    {
      id: 'tenant-isolation',
      title: 'Tenant isolation',
      description:
        'Ensure each tenant can only access their own data by enforcing tenant boundaries at the data access layer, preventing cross-tenant data leakage.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 7,
      requiredSkills: ['backend', 'security', 'database'],
      tags: ['concern:security', 'layer:data'],
      implementationGuidance:
        'Enforce tenant scoping at the repository or ORM layer by automatically applying a tenant filter to all queries. Extract the tenant identifier from the authenticated context and inject it into every data access call. Consider row-level security in the database for defense in depth. Audit queries to verify no cross-tenant access is possible.',
    },

    // DEFERRED
    {
      id: 'api-documentation',
      title: 'API documentation (OpenAPI)',
      description:
        'Generate and serve an OpenAPI specification from route definitions, providing interactive documentation for API consumers.',
      category: 'documentation',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'documentation'],
      tags: ['concern:documentation', 'layer:api'],
      implementationGuidance:
        'Use an OpenAPI generator that derives the spec from your route definitions and validation schemas (e.g., swagger-jsdoc, fastify-swagger, @nestjs/swagger). Serve Swagger UI at /docs in non-production environments. Keep the spec in sync with code by generating it at build time rather than maintaining it manually.',
    },
    {
      id: 'distributed-tracing',
      title: 'Distributed tracing',
      description:
        'Instrument the service to emit trace spans for each request and propagate trace context to downstream services for end-to-end visibility.',
      category: 'observability',
      urgency: 'deferred',
      estimatedComplexity: 6,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Integrate an OpenTelemetry SDK to auto-instrument HTTP handlers and outbound calls. Export spans to a tracing backend (Jaeger, Zipkin, or a managed service). Propagate W3C Trace Context headers on outbound requests. Add custom spans around critical business operations for finer granularity.',
    },
    {
      id: 'ci-cd-pipeline',
      title: 'CI/CD pipeline',
      description:
        'Automate build, test, lint, and deployment steps in a continuous integration pipeline that runs on every push and deploys on merge to main.',
      category: 'ci-cd',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['devops', 'ci-cd'],
      tags: ['concern:ci-cd', 'layer:infra'],
      implementationGuidance:
        'Define pipeline configuration (GitHub Actions, GitLab CI, etc.) with stages: lint, type-check, unit test, integration test, build, deploy. Run tests in parallel where possible. Use environment-specific deploy steps with manual approval for production. Cache dependencies between runs to speed up builds.',
    },
    {
      id: 'metrics-collection',
      title: 'Metrics collection',
      description:
        'Collect and expose application metrics (request latency, error rates, throughput, resource usage) for dashboards and alerting.',
      category: 'observability',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Instrument the application with a metrics library (e.g., prom-client for Prometheus). Expose a /metrics endpoint for scraping. Track RED metrics (Rate, Errors, Duration) per endpoint. Add custom business metrics as needed. Set up dashboard templates and alerting rules for key SLIs.',
    },
    {
      id: 'api-versioning-impl',
      title: 'API versioning',
      description:
        'Introduce a versioning strategy for the API so that breaking changes can be rolled out without disrupting existing consumers.',
      category: 'api-design',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:api-design', 'layer:api'],
      implementationGuidance:
        'Choose a versioning strategy: URL path prefix (/v1/, /v2/), Accept header with media type versioning, or custom header. Implement version-aware routing that maps requests to the correct handler version. Maintain backward compatibility within a major version. Document the deprecation policy and sunset timeline for old versions.',
    },
    {
      id: 'load-testing',
      title: 'Load testing setup',
      description:
        'Establish load testing scripts and infrastructure to validate performance characteristics under expected and peak traffic conditions.',
      category: 'performance',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['testing', 'performance'],
      tags: ['concern:performance', 'layer:tests'],
      implementationGuidance:
        'Use a load testing tool (e.g., k6, Artillery, or autocannon) to script realistic traffic patterns. Define baseline performance budgets (p99 latency, max throughput). Run load tests against a staging environment that mirrors production. Store results for trend analysis and regression detection.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'internet-facing',
      answerEquals: true,
      addConcerns: ['rate-limiting'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'multi-tenant',
      answerEquals: true,
      addConcerns: ['tenant-isolation'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'api-versioning',
      answerEquals: true,
      addConcerns: ['api-versioning-impl'],
      promoteToUrgency: 'pattern-first',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'input-validation',
    'error-handling',
    'auth-middleware',
    'health-check',
    'structured-logging',
    'graceful-shutdown',
    'env-config',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['REST-server', 'http-server', 'express-app', 'fastify-app', 'koa-app'],
    frameworks: [
      'framework:express',
      'framework:fastify',
      'framework:koa',
      'framework:hapi',
      'framework:nestjs',
    ],
    capabilities: ['REST-server', 'http-server'],
    fileIndicators: ['routes/', 'controllers/', 'middleware/', 'src/routes/', 'src/controllers/'],
    weight: 0.8,
  },
};
