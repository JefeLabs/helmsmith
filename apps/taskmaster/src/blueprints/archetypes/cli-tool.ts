import type { ApplicationBlueprint } from '../types.js';

export const CLI_TOOL_BLUEPRINT: ApplicationBlueprint = {
  id: 'cli-tool',
  name: 'CLI Tool',
  description:
    'Command-line application with argument parsing, structured output, configuration loading, and proper exit code semantics for scripting and automation.',
  appType: 'cli',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'complexity',
      question: 'What is the complexity level of the CLI?',
      type: 'single-select',
      options: ['simple', 'moderate', 'complex'],
      default: 'moderate',
    },
    {
      id: 'interactive',
      question: 'Does the CLI include interactive prompts?',
      type: 'boolean',
      default: false,
    },
    {
      id: 'config-format',
      question: 'What configuration format will be used?',
      type: 'single-select',
      options: ['json', 'yaml', 'toml', 'env', 'none'],
      default: 'json',
    },
    {
      id: 'output-format',
      question: 'What output formats should be supported?',
      type: 'single-select',
      options: ['text', 'json', 'table', 'mixed'],
      default: 'text',
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'arg-parsing',
      title: 'Argument parsing',
      description:
        'Parse command-line arguments, flags, and subcommands into a structured options object with type coercion and validation.',
      category: 'core',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['cli', 'backend'],
      tags: ['concern:core', 'layer:cli'],
      implementationGuidance:
        'Use a mature argument parser (e.g., Commander.js, yargs, or meow). Define commands, options, and positional arguments with types, defaults, and descriptions. Validate mutually exclusive flags and required combinations at parse time rather than in business logic.',
    },
    {
      id: 'error-exit-codes',
      title: 'Error exit codes',
      description:
        'Return meaningful exit codes that distinguish between success, user errors, system errors, and specific failure modes for scripting consumption.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['cli'],
      tags: ['concern:reliability', 'layer:cli'],
      implementationGuidance:
        'Define an exit code enum: 0 for success, 1 for general errors, 2 for usage/argument errors, and higher codes for domain-specific failures. Catch all unhandled exceptions at the top level and map them to the appropriate exit code. Never call process.exit() deep in business logic; instead throw typed errors.',
    },
    {
      id: 'help-text',
      title: 'Help text and usage',
      description:
        'Provide clear, auto-generated help text for all commands and options, including usage examples and flag descriptions.',
      category: 'usability',
      urgency: 'upfront',
      estimatedComplexity: 2,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Leverage the argument parser built-in help generation. Add descriptive summaries for each command and option. Include usage examples in the help output. Ensure --help and -h work at every subcommand level.',
    },
    {
      id: 'config-loading',
      title: 'Configuration loading',
      description:
        'Load configuration from files, environment variables, and command-line flags with a clear precedence order and sensible defaults.',
      category: 'config-management',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['cli', 'backend'],
      tags: ['concern:config-management', 'layer:cli'],
      implementationGuidance:
        'Establish a config precedence: CLI flags override environment variables, which override config file values, which override defaults. Search standard locations for config files (current directory, home directory, XDG paths). Validate the merged config with a schema and report errors with the source that provided the invalid value.',
    },
    {
      id: 'input-validation',
      title: 'Input validation',
      description:
        'Validate all user-provided inputs (arguments, file paths, piped data) and provide clear, actionable error messages on validation failure.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['cli'],
      tags: ['concern:reliability', 'layer:cli'],
      implementationGuidance:
        'Validate inputs immediately after parsing, before any business logic runs. Check file existence and permissions for path arguments. Validate format constraints (e.g., valid JSON, valid URL). Return exit code 2 with a message that tells the user exactly what was wrong and how to fix it.',
    },

    // PATTERN-FIRST
    {
      id: 'output-formatting',
      title: 'Output formatting',
      description:
        'Support multiple output formats (plain text, JSON, table) controlled by flags, making the CLI useful for both humans and scripts.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Implement a formatter abstraction that accepts structured data and renders it based on the --output flag. Default to human-readable text. Support --output json for machine consumption and --output table for tabular data. Write to stdout for data and stderr for status messages so output can be piped.',
    },
    {
      id: 'progress-indicators',
      title: 'Progress indicators',
      description:
        'Display progress bars, spinners, or status messages for long-running operations, with automatic suppression when output is piped.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Use a library like ora (spinners) or cli-progress (bars) for interactive terminals. Detect whether stdout is a TTY and suppress progress UI when piped. Write progress to stderr so it does not corrupt piped output. Update progress at meaningful intervals to avoid excessive rendering.',
    },
    {
      id: 'shell-completion',
      title: 'Shell completion',
      description:
        'Generate tab-completion scripts for bash, zsh, and fish so users can discover commands and options interactively.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Implement a hidden completion command that outputs shell-specific completion scripts (e.g., `mycli completion bash`). Many argument parsers (yargs, Commander.js) have built-in completion support. Include installation instructions in the help text.',
    },
    {
      id: 'verbose-quiet-modes',
      title: 'Verbose and quiet modes',
      description:
        'Support --verbose for debug-level output and --quiet for suppressing all non-essential output, giving users control over verbosity.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 2,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Implement a log level system controlled by --verbose (debug), default (info), and --quiet (error-only). Route all non-essential output through a logger that respects the current level. Ensure --quiet suppresses everything except the final result and errors.',
    },
    {
      id: 'stdin-pipe-support',
      title: 'Stdin pipe support',
      description:
        'Accept input from stdin when no file argument is provided, enabling the CLI to participate in Unix pipelines.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Detect when stdin is a pipe (not a TTY) and read input from it when no file argument is given. Use the convention of `-` as a filename to explicitly mean stdin. Buffer stdin input before processing; stream it for large inputs. Handle the case where stdin is empty or the pipe is closed prematurely.',
    },
    {
      id: 'testing-harness',
      title: 'CLI testing harness',
      description:
        'Establish a test infrastructure that can invoke the CLI as a subprocess, capture stdout/stderr/exit codes, and assert on the results.',
      category: 'testing',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['cli', 'testing'],
      tags: ['concern:testing', 'layer:tests'],
      implementationGuidance:
        'Create test helpers that spawn the CLI as a child process and capture stdout, stderr, and exit code. Support passing arguments, environment variables, and stdin input. Set generous timeouts for E2E tests (10-15 seconds). Use fixture files for complex input scenarios.',
    },

    // DEFERRED
    {
      id: 'man-pages',
      title: 'Man page generation',
      description:
        'Generate Unix man pages from the command and option definitions so the CLI integrates with the system documentation ecosystem.',
      category: 'documentation',
      urgency: 'deferred',
      estimatedComplexity: 3,
      requiredSkills: ['cli', 'documentation'],
      tags: ['concern:documentation', 'layer:cli'],
      implementationGuidance:
        'Use a man page generator (e.g., marked-man or ronn) to convert markdown documentation to roff format. Include the generated man pages in the npm package and install them to the correct location. Keep the source markdown in sync with the argument parser definitions.',
    },
    {
      id: 'plugin-system',
      title: 'Plugin system',
      description:
        'Allow third-party extensions to register new commands, transformers, or output formats without modifying the core CLI codebase.',
      category: 'extensibility',
      urgency: 'deferred',
      estimatedComplexity: 7,
      requiredSkills: ['cli', 'architecture'],
      tags: ['concern:extensibility', 'layer:cli'],
      implementationGuidance:
        'Define a plugin interface with lifecycle hooks (init, register commands, teardown). Discover plugins from node_modules (convention-based naming, e.g., mycli-plugin-*) or a config file. Load plugins dynamically and validate they conform to the interface. Provide a plugin development guide with examples.',
    },
    {
      id: 'update-checker',
      title: 'Update checker',
      description:
        'Notify users when a newer version of the CLI is available, without blocking execution or requiring network access for normal operation.',
      category: 'usability',
      urgency: 'deferred',
      estimatedComplexity: 3,
      requiredSkills: ['cli'],
      tags: ['concern:usability', 'layer:cli'],
      implementationGuidance:
        'Check for updates asynchronously on startup (e.g., using update-notifier) and cache the result to avoid repeated network requests. Display the update notice after command output, not before. Respect CI environments and --quiet mode by suppressing the notice. Allow users to disable the check via config or environment variable.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'interactive',
      answerEquals: true,
      addConcerns: ['progress-indicators'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'complexity',
      answerEquals: 'complex',
      addConcerns: ['plugin-system'],
      promoteToUrgency: 'pattern-first',
    },
    {
      questionId: 'output-format',
      answerEquals: 'mixed',
      addConcerns: ['output-formatting'],
      promoteToUrgency: 'upfront',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'arg-parsing',
    'error-exit-codes',
    'help-text',
    'config-loading',
    'input-validation',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['CLI-app'],
    frameworks: [],
    capabilities: ['CLI-app'],
    fileIndicators: ['bin/', 'cli/', 'commands/', 'src/cli.ts', 'src/commands/'],
    weight: 0.7,
  },
};
