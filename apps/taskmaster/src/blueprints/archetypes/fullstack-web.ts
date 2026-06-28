import type { ApplicationBlueprint } from '../types.js';

export const FULLSTACK_WEB_BLUEPRINT: ApplicationBlueprint = {
  id: 'fullstack-web',
  name: 'Full-Stack Web App',
  description:
    'Full-stack web application combining a frontend framework with a backend API, database, authentication, and deployment infrastructure.',
  appType: 'fullstack',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'frontend-framework',
      question: 'Which frontend framework will be used?',
      type: 'single-select',
      options: ['react', 'vue', 'svelte', 'none'],
      default: 'react',
    },
    {
      id: 'database',
      question: 'Which database will be used?',
      type: 'single-select',
      options: ['postgres', 'mysql', 'mongodb', 'sqlite'],
      default: 'postgres',
    },
    {
      id: 'auth-method',
      question: 'What authentication method will be used?',
      type: 'single-select',
      options: ['session', 'jwt', 'oauth', 'none'],
      default: 'session',
    },
    {
      id: 'deployment',
      question: 'What is the deployment target?',
      type: 'single-select',
      options: ['docker', 'serverless', 'traditional'],
      default: 'docker',
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'api-error-handling',
      title: 'API error handling',
      description:
        'Return structured, consistent error responses from all API endpoints with appropriate HTTP status codes and error classification for both frontend consumption and debugging.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'frontend'],
      tags: ['concern:error-handling', 'layer:api'],
      implementationGuidance:
        'Create a centralized error handler middleware on the backend that catches all errors and returns a standard envelope: { error: { code, message, details? } }. On the frontend, create an API client wrapper that parses these error responses and surfaces them consistently in the UI. Map domain errors to HTTP status codes in one place.',
    },
    {
      id: 'db-migrations',
      title: 'Database migrations',
      description:
        'Manage database schema changes through versioned migration files that can be applied, rolled back, and tracked across all environments.',
      category: 'data',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'database'],
      tags: ['concern:data', 'layer:data'],
      implementationGuidance:
        'Use an ORM migration tool (Prisma Migrate, Knex migrations, TypeORM migrations) to generate and track schema changes. Store migrations in version control. Run migrations as a separate deployment step, never on application startup in production. Include both up and down migrations for reversibility.',
    },
    {
      id: 'auth-system',
      title: 'Authentication system',
      description:
        'Implement end-to-end authentication spanning login/logout flows on the frontend, credential verification on the backend, and secure session or token management.',
      category: 'security',
      urgency: 'upfront',
      estimatedComplexity: 7,
      requiredSkills: ['backend', 'frontend', 'security'],
      tags: ['concern:security', 'layer:api', 'layer:ui'],
      implementationGuidance:
        'Implement the chosen auth strategy end-to-end: session-based (httpOnly cookies with CSRF protection), JWT (access + refresh token rotation), or OAuth (provider integration with callback handling). Protect API routes with auth middleware. On the frontend, manage auth state and redirect unauthenticated users. Hash passwords with bcrypt or argon2.',
    },
    {
      id: 'env-config',
      title: 'Environment configuration',
      description:
        'Load and validate configuration from environment variables with separate configs for development, staging, and production, failing fast on missing required values.',
      category: 'config-management',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:config-management', 'layer:infra'],
      implementationGuidance:
        'Create a config module that reads from process.env and validates with a Zod schema. Provide a .env.example file documenting all variables. Use dotenv for local development only (never in production). Separate frontend and backend env vars clearly; prefix frontend vars appropriately (VITE_, NEXT_PUBLIC_). Fail at startup if required variables are missing.',
    },
    {
      id: 'health-checks',
      title: 'Health checks',
      description:
        'Expose liveness and readiness endpoints that verify the server process and its dependencies (database, cache, external services) are operational.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 2,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:api'],
      implementationGuidance:
        'Add GET /health (liveness: process is running) and GET /ready (readiness: database connected, migrations applied, cache reachable). Return 200 with a JSON body listing each dependency status. Use the readiness endpoint as the deployment gate to prevent routing traffic to unready instances.',
    },
    {
      id: 'input-validation',
      title: 'Input validation',
      description:
        'Validate all user inputs on both the client side (for immediate feedback) and the server side (for security), using shared validation schemas where possible.',
      category: 'security',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'frontend'],
      tags: ['concern:security', 'layer:api', 'layer:ui'],
      implementationGuidance:
        'Define validation schemas using Zod or Yup that can be shared between frontend forms and backend route handlers. Validate on the frontend for UX (inline errors, disabled submit) and on the backend for security (never trust client validation alone). Return 400 with field-level error details for invalid API requests.',
    },

    // PATTERN-FIRST
    {
      id: 'cors',
      title: 'CORS configuration',
      description:
        'Configure cross-origin resource sharing to allow the frontend origin to access backend APIs while blocking unauthorized origins.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 2,
      requiredSkills: ['backend'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Configure CORS middleware with an explicit allowlist of frontend origins (never use wildcard in production with credentials). Allow only the HTTP methods and headers your API uses. Set appropriate max-age for preflight caching. In development, allow localhost origins; in production, restrict to your domain.',
    },
    {
      id: 'csrf-protection',
      title: 'CSRF protection',
      description:
        'Protect state-changing API endpoints from cross-site request forgery attacks when using cookie-based authentication.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['backend', 'security'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Use the synchronizer token pattern: generate a CSRF token per session, include it in a meta tag or cookie, and require it as a header (X-CSRF-Token) on all mutating requests. Use the double-submit cookie pattern if the frontend and backend are on different origins. Skip CSRF protection for API-key or JWT-authenticated endpoints since they are not vulnerable.',
    },
    {
      id: 'session-management',
      title: 'Session management',
      description:
        'Manage user sessions with secure storage, expiration, renewal, and invalidation across the frontend and backend.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'security'],
      tags: ['concern:security', 'layer:api'],
      implementationGuidance:
        'Store sessions server-side (Redis, database) with a secure, httpOnly, sameSite cookie containing only the session ID. Set appropriate expiration and implement sliding window renewal. Invalidate sessions on logout and password change. Implement session limits per user to prevent session fixation attacks.',
    },
    {
      id: 'form-validation',
      title: 'Form validation',
      description:
        'Implement client-side form validation with real-time feedback, accessible error messages, and graceful handling of server-side validation errors.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['frontend'],
      tags: ['concern:usability', 'layer:ui'],
      implementationGuidance:
        'Use a form library (React Hook Form, VeeValidate) with schema validation. Validate on blur for individual fields and on submit for the full form. Display server-side validation errors inline by mapping API error responses to form field errors. Share validation schemas with the backend to keep rules in sync.',
    },
    {
      id: 'file-uploads',
      title: 'File uploads',
      description:
        'Handle file uploads with size limits, type validation, progress indication, and secure storage on the backend.',
      category: 'feature',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'frontend'],
      tags: ['concern:feature', 'layer:api', 'layer:ui'],
      implementationGuidance:
        'Use multipart form data with a library like multer or busboy on the backend. Validate file type (MIME type and magic bytes, not just extension) and enforce size limits. Stream large files to storage (S3, disk) rather than buffering in memory. On the frontend, show upload progress and allow cancellation. Generate unique filenames to prevent collisions.',
    },
    {
      id: 'email-sending',
      title: 'Email sending',
      description:
        'Send transactional emails (verification, password reset, notifications) using templates with reliable delivery and error handling.',
      category: 'feature',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend'],
      tags: ['concern:feature', 'layer:service'],
      implementationGuidance:
        'Use an email service provider (SendGrid, SES, Postmark) rather than a self-hosted SMTP server. Create email templates using a templating engine. Send emails asynchronously via a job queue to avoid blocking API responses. Log all send attempts and handle bounce/complaint webhooks. Use a preview mode for development.',
    },
    {
      id: 'background-jobs',
      title: 'Background jobs',
      description:
        'Process long-running or deferred work (email, image processing, reports) in background workers outside the request-response cycle.',
      category: 'architecture',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:architecture', 'layer:service'],
      implementationGuidance:
        'Use a job queue (BullMQ, Agenda, pg-boss) to enqueue work from API handlers and process it in a separate worker process. Define job schemas and validate payloads. Implement retry with backoff for transient failures. Add a dead-letter mechanism for permanently failed jobs. Monitor queue depth and processing latency.',
    },
    {
      id: 'caching',
      title: 'Caching strategy',
      description:
        'Reduce database load and API latency by caching frequently accessed data at the server level and using HTTP cache headers for static assets.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'performance'],
      tags: ['concern:performance', 'layer:service'],
      implementationGuidance:
        'Use Redis or an in-memory cache for server-side caching of hot data (user profiles, config, listings). Set Cache-Control headers for static frontend assets with content hashing for cache busting. Implement cache invalidation on writes. Start with conservative TTLs and adjust based on observed cache hit rates.',
    },
    {
      id: 'logging',
      title: 'Structured logging',
      description:
        'Emit structured log entries from both the backend API and background workers with request correlation, user context, and appropriate log levels.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Use a structured JSON logger (pino, winston). Attach request ID, user ID, and route to every log entry via middleware. Log at info for request lifecycle, warn for degraded paths, and error for failures. Ship logs to a centralized platform (ELK, Datadog, CloudWatch) for searching and alerting.',
    },
    {
      id: 'monitoring',
      title: 'Application monitoring',
      description:
        'Track application health metrics (response times, error rates, database query performance) and set up alerts for anomalies.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Instrument the application with metrics collection (prom-client, Datadog APM, New Relic). Track request duration histograms, error counters, and database query times. Set up dashboards for the key RED metrics (Rate, Errors, Duration). Configure alerts for error rate spikes, high latency, and resource exhaustion.',
    },

    // DEFERRED
    {
      id: 'ci-cd',
      title: 'CI/CD pipeline',
      description:
        'Automate linting, testing, building, and deploying the full stack through a continuous integration and delivery pipeline.',
      category: 'ci-cd',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['devops', 'ci-cd'],
      tags: ['concern:ci-cd', 'layer:infra'],
      implementationGuidance:
        'Define a pipeline (GitHub Actions, GitLab CI) with stages: lint, type-check, unit test, integration test, build frontend, build backend, deploy. Run frontend and backend stages in parallel where possible. Use environment-specific deploy steps. Cache node_modules and build artifacts between runs.',
    },
    {
      id: 'api-documentation',
      title: 'API documentation',
      description:
        'Generate and serve interactive API documentation from route definitions and validation schemas for frontend developer and third-party consumption.',
      category: 'documentation',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'documentation'],
      tags: ['concern:documentation', 'layer:api'],
      implementationGuidance:
        'Use an OpenAPI generator that derives the spec from your route definitions and Zod/Joi schemas. Serve Swagger UI or Redoc at /docs. Keep the spec in sync with code by generating it at build time. Include request and response examples for each endpoint.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'auth-method',
      answerEquals: 'session',
      addConcerns: ['csrf-protection', 'session-management'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'deployment',
      answerEquals: 'docker',
      addConcerns: ['ci-cd'],
      promoteToUrgency: 'pattern-first',
    },
    {
      questionId: 'frontend-framework',
      answerEquals: 'none',
      addConcerns: ['api-documentation'],
      promoteToUrgency: 'pattern-first',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'api-error-handling',
    'db-migrations',
    'auth-system',
    'env-config',
    'health-checks',
    'input-validation',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['frontend-framework', 'REST-server', 'database-migrations'],
    frameworks: [],
    capabilities: [],
    fileIndicators: ['src/server/', 'src/client/', 'pages/', 'api/', 'migrations/'],
    weight: 0.6,
  },
};
