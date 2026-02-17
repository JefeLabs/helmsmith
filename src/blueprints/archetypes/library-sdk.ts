import type { ApplicationBlueprint } from '../types.js';

export const LIBRARY_SDK_BLUEPRINT: ApplicationBlueprint = {
  id: 'library-sdk',
  name: 'Library/SDK',
  description:
    'Reusable library or SDK with a well-designed API surface, typed exports, dual ESM/CJS builds, comprehensive tests, and clear documentation.',
  appType: 'library',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'target-runtime',
      question: 'What is the target runtime?',
      type: 'single-select',
      options: ['node', 'browser', 'universal'],
      default: 'node',
    },
    {
      id: 'module-format',
      question: 'What module format should be published?',
      type: 'single-select',
      options: ['esm', 'cjs', 'dual'],
      default: 'dual',
    },
    {
      id: 'typescript',
      question: 'Is the library written in TypeScript?',
      type: 'boolean',
      default: true,
    },
    {
      id: 'tree-shakeable',
      question: 'Should the library be tree-shakeable?',
      type: 'boolean',
      default: true,
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'api-surface-design',
      title: 'API surface design',
      description:
        'Design a minimal, intuitive public API with clear entry points, consistent naming conventions, and a well-defined boundary between public and internal modules.',
      category: 'architecture',
      urgency: 'upfront',
      estimatedComplexity: 6,
      requiredSkills: ['architecture', 'api-design'],
      tags: ['concern:architecture', 'layer:api'],
      implementationGuidance:
        'Export the public API from a single index.ts entry point. Keep the API surface small; prefer composition over configuration. Use the principle of least surprise for method names and parameter ordering. Mark internal modules with a leading underscore or a separate internal export path. Document every public function, class, and type with JSDoc.',
    },
    {
      id: 'error-types',
      title: 'Error types',
      description:
        'Define a typed error hierarchy that allows consumers to catch and handle specific error conditions programmatically without relying on message string matching.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:reliability', 'layer:api'],
      implementationGuidance:
        'Create a base error class that extends Error with a code property. Define specific error subclasses for each failure mode (ValidationError, NotFoundError, TimeoutError). Export all error classes so consumers can use instanceof checks. Include the original error in the cause property for wrapping.',
    },
    {
      id: 'dual-build',
      title: 'Dual ESM/CJS build',
      description:
        'Produce both ESM and CommonJS output from a single source so the library works in all Node.js and bundler environments without consumer configuration.',
      category: 'tooling',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['tooling', 'backend'],
      tags: ['concern:tooling', 'layer:infra'],
      implementationGuidance:
        'Use a build tool (tsup, unbuild, or rollup) configured to emit both ESM (.mjs) and CJS (.cjs) bundles. Set the package.json exports map with "import" and "require" conditions. Include "types" conditions for TypeScript consumers. Test the built output by importing it in both ESM and CJS test scripts to verify correctness.',
    },
    {
      id: 'test-suite',
      title: 'Comprehensive test suite',
      description:
        'Establish thorough unit and integration tests covering the public API, edge cases, and error paths, with high code coverage targets.',
      category: 'testing',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['testing'],
      tags: ['concern:testing', 'layer:tests'],
      implementationGuidance:
        'Use a test runner (Vitest, Jest) and test every public API method with happy path, edge case, and error scenarios. Aim for 90%+ line coverage on the public API surface. Use property-based testing (fast-check) for functions with broad input domains. Mock external dependencies at the boundary. Run tests against both ESM and CJS builds.',
    },
    {
      id: 'readme-docs',
      title: 'README documentation',
      description:
        'Provide a comprehensive README with installation instructions, quick-start examples, API reference, and migration guides for consumers.',
      category: 'documentation',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['documentation'],
      tags: ['concern:documentation', 'layer:docs'],
      implementationGuidance:
        'Structure the README with: badges, one-line description, installation, quick start (copy-pasteable example), API reference (or link to generated docs), configuration options, error handling guide, and contributing section. Keep examples runnable and tested. Update the README as part of every API change.',
    },

    // PATTERN-FIRST
    {
      id: 'type-declarations',
      title: 'Type declarations',
      description:
        'Ship accurate TypeScript declaration files (.d.ts) alongside the JavaScript output so TypeScript consumers get full type safety and editor support.',
      category: 'tooling',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['typescript'],
      tags: ['concern:tooling', 'layer:infra'],
      implementationGuidance:
        'Generate .d.ts files from the TypeScript source using tsc --declaration or the bundler declaration plugin. Point the "types" field in package.json to the generated declarations. Verify the declarations are correct by consuming them in a separate TypeScript project. Avoid re-exporting internal types that are not part of the public API.',
    },
    {
      id: 'changelog',
      title: 'Changelog maintenance',
      description:
        'Maintain a changelog documenting all notable changes, new features, bug fixes, and breaking changes for each release version.',
      category: 'documentation',
      urgency: 'pattern-first',
      estimatedComplexity: 2,
      requiredSkills: ['documentation'],
      tags: ['concern:documentation', 'layer:docs'],
      implementationGuidance:
        'Follow the Keep a Changelog format with sections for Added, Changed, Deprecated, Removed, Fixed, and Security. Update the changelog in the same PR as the code change. Use conventional commits to automate changelog generation if the team adopts that convention. Link to the diff between versions.',
    },
    {
      id: 'semantic-versioning',
      title: 'Semantic versioning',
      description:
        'Follow semantic versioning strictly so consumers can depend on version ranges with confidence that breaking changes only occur in major versions.',
      category: 'operations',
      urgency: 'pattern-first',
      estimatedComplexity: 2,
      requiredSkills: ['operations'],
      tags: ['concern:operations', 'layer:infra'],
      implementationGuidance:
        'Bump the major version for breaking API changes, minor for new features, and patch for bug fixes. Use a release tool (changesets, semantic-release, or np) to automate version bumping, changelog generation, and npm publishing. Document what constitutes a breaking change in the contributing guide.',
    },
    {
      id: 'example-code',
      title: 'Example code',
      description:
        'Provide runnable example scripts demonstrating common use cases so consumers can quickly understand how to integrate the library.',
      category: 'documentation',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['documentation'],
      tags: ['concern:documentation', 'layer:docs'],
      implementationGuidance:
        'Create an examples/ directory with self-contained scripts for each major use case. Each example should be runnable with a single command (e.g., npx tsx examples/basic.ts). Test examples in CI to ensure they stay in sync with the API. Reference examples from the README.',
    },
    {
      id: 'bundle-analysis',
      title: 'Bundle size analysis',
      description:
        'Monitor and minimize the library bundle size to avoid bloating consumer applications, especially for browser-targeted libraries.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['tooling', 'performance'],
      tags: ['concern:performance', 'layer:infra'],
      implementationGuidance:
        'Use size-limit or bundlephobia to track the library size. Set a size budget and fail CI if the built output exceeds it. Audit dependencies and prefer zero-dependency or lightweight alternatives. Mark heavy optional dependencies as peer dependencies. Use subpath exports to allow consumers to import only what they need.',
    },
    {
      id: 'peer-dependencies',
      title: 'Peer dependency management',
      description:
        'Declare framework or runtime dependencies as peer dependencies to avoid version conflicts and duplicate installations in consumer projects.',
      category: 'operations',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['tooling'],
      tags: ['concern:operations', 'layer:infra'],
      implementationGuidance:
        'List framework dependencies (React, Vue, etc.) as peerDependencies with a wide version range. Provide peerDependenciesMeta to mark optional peers. Test against the minimum and maximum supported peer versions in CI. Document supported peer version ranges in the README.',
    },

    // DEFERRED
    {
      id: 'deprecation-strategy',
      title: 'Deprecation strategy',
      description:
        'Define a process for deprecating APIs with advance notice, migration guides, and a predictable removal timeline.',
      category: 'operations',
      urgency: 'deferred',
      estimatedComplexity: 3,
      requiredSkills: ['architecture'],
      tags: ['concern:operations', 'layer:api'],
      implementationGuidance:
        'Mark deprecated APIs with @deprecated JSDoc tags and console.warn at runtime (once per session). Provide the replacement API in the deprecation message. Maintain deprecated APIs for at least one major version before removal. Document the deprecation policy in the contributing guide.',
    },
    {
      id: 'benchmarks',
      title: 'Performance benchmarks',
      description:
        'Establish benchmarks for performance-critical operations to detect regressions and compare implementations objectively.',
      category: 'performance',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['performance', 'testing'],
      tags: ['concern:performance', 'layer:tests'],
      implementationGuidance:
        'Use a benchmarking library (Bench, tinybench, or benchmark.js) to measure throughput and latency of critical functions. Store benchmark results in CI artifacts for trend analysis. Run benchmarks on a consistent environment to reduce noise. Compare results between branches to catch regressions before merging.',
    },
    {
      id: 'contributor-guide',
      title: 'Contributor guide',
      description:
        'Provide documentation for external contributors covering setup, coding standards, testing expectations, and the pull request process.',
      category: 'documentation',
      urgency: 'deferred',
      estimatedComplexity: 2,
      requiredSkills: ['documentation'],
      tags: ['concern:documentation', 'layer:docs'],
      implementationGuidance:
        'Create a CONTRIBUTING.md with: prerequisites, local setup instructions, coding style and linting rules, how to run tests, how to write commit messages, and the PR review process. Include a code of conduct. Link to it from the README and the GitHub issue templates.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'typescript',
      answerEquals: true,
      addConcerns: ['type-declarations'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'tree-shakeable',
      answerEquals: true,
      addConcerns: ['bundle-analysis'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'target-runtime',
      answerEquals: 'browser',
      addConcerns: ['bundle-analysis'],
      promoteToUrgency: 'upfront',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'api-surface-design',
    'error-types',
    'dual-build',
    'test-suite',
    'readme-docs',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['library', 'SDK'],
    frameworks: [],
    capabilities: ['library'],
    fileIndicators: ['lib/', 'dist/', 'index.ts', 'index.js', 'src/index.ts'],
    weight: 0.6,
  },
};
