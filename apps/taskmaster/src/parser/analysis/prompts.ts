import type { ChatCompletionMessage } from '../../auth/types.js';
import type { ArchitectureAnalysis, CodebaseScanResult, SourceAnalysisResult } from './types.js';
import type { ApplicationBlueprint, BlueprintConcern } from '../../blueprints/types.js';
import { formatScanForPrompt } from './codebase-scanner.js';

/**
 * Build the Phase 1 prompt: Architecture Discovery.
 *
 * Instructs the AI to identify components, interfaces, data sources,
 * and cross-cutting concerns from a PRD document + optional codebase scan.
 */
export function buildArchitectureDiscoveryPrompt(
  documentContent: string,
  scanResult?: CodebaseScanResult | null,
  sourceAnalysis?: SourceAnalysisResult | null,
  componentIndexSummary?: string | null,
  entryPointIndexSummary?: string | null,
): ChatCompletionMessage[] {
  const systemContent = [
    'You are a senior software architect analyzing a project document.',
    'Your job is to identify the key architectural elements of the project.',
    '',
    'Return ONLY a valid JSON object with no additional text, markdown, or explanation.',
    '',
    'Required JSON structure:',
    '{',
    '  "summary": "1-2 paragraph project summary",',
    '  "components": [',
    '    {',
    '      "name": "kebab-case-name",',
    '      "description": "what this component does",',
    '      "techStack": ["TypeScript", "Express"],',
    '      "layer": "frontend|backend|infrastructure|shared|data|external",',
    '      "patterns": ["MVC", "repository pattern"],',
    '      "entryPoints": ["src/auth/index.ts"]',
    '    }',
    '  ],',
    '  "interfaces": [',
    '    {',
    '      "from": "component-name (consumer)",',
    '      "to": "component-name (provider)",',
    '      "type": "REST|gRPC|WebSocket|messageQueue|internal|eventBus|fileSystem|CLI",',
    '      "description": "what data flows between them"',
    '    }',
    '  ],',
    '  "dataSources": [',
    '    {',
    '      "name": "kebab-case-name",',
    '      "type": "postgres|mysql|mongodb|redis|elasticsearch|s3|sqlite|external-api|file-system|in-memory|other",',
    '      "ownerComponent": "component-name",',
    '      "description": "what data it stores"',
    '    }',
    '  ],',
    '  "crossCuttingConcerns": [',
    '    {',
    '      "name": "security|logging|telemetry|config-management|error-handling|testing|documentation|ci-cd|performance|accessibility",',
    '      "scope": "where it applies",',
    '      "relatedComponents": ["comp1", "comp2"],',
    '      "implementationNotes": "how to implement"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Component names must be kebab-case',
    '- Every interface must reference valid component names from the components array',
    '- Every data source must reference a valid ownerComponent',
    '- Identify 3-10 components depending on project complexity',
    '- Include at least one interface if there are 2+ components',
    '- Cross-cutting concerns should only be included if clearly mentioned or implied',
    '- Be specific about tech stack based on the document content and any codebase scan data',
    '',
    'If entry point data is provided, also return these optional arrays:',
    '  "entryPoints": [{ "id": "ep:component:name", "name": "human label", "category": "http-api|ui-route|cli-command|event|job-cron|internal-service|callback-webhook", "componentId": "owning-component", "filePath": "relative/path", "symbolName": "handler", "metadata": {}, "detectedBy": "static|ai|manifest|manual", "confidence": 0.0-1.0, "tags": [] }],',
    '  "sideEffects": [{ "type": "database-write|database-read|cache-mutation|file-write|file-read|external-api-call|event-publish|email-send|notification|queue-enqueue|state-mutation", "target": "resource-name", "description": "what happens", "componentId": "component", "detectedBy": "static|ai|manual" }],',
    '  "entryPointTraces": [{ "entryPointId": "ep:x:y", "componentChain": ["comp1","comp2"], "sideEffects": [...], "externalSystems": [], "dataSourcesAccessed": [], "description": "narrative" }]',
    '',
    'These arrays default to [] if you cannot determine them from the provided data.',
  ].join('\n');

  const userParts: string[] = [];

  userParts.push('=== PROJECT DOCUMENT ===');
  userParts.push(documentContent);

  if (scanResult) {
    userParts.push('');
    userParts.push('=== CODEBASE SCAN ===');
    userParts.push(formatScanForPrompt(scanResult));
  }

  if (sourceAnalysis && sourceAnalysis.summary) {
    userParts.push('');
    userParts.push('=== SOURCE ANALYSIS ===');
    userParts.push(sourceAnalysis.summary);
  }

  if (componentIndexSummary) {
    userParts.push('');
    userParts.push('=== COMPONENT INDEX ===');
    userParts.push(componentIndexSummary);
  }

  if (entryPointIndexSummary) {
    userParts.push('');
    userParts.push('=== ENTRY POINT INDEX (pre-detected) ===');
    userParts.push(entryPointIndexSummary);
    userParts.push('');
    userParts.push('Refine these entry points: correct categories, add missing ones, infer side effects and traces.');
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userParts.join('\n') },
  ];
}

/**
 * Build the Phase 2 prompt: Task Generation.
 *
 * Takes the Phase 1 architecture analysis and generates tasks
 * organized by component with proper tags and dependencies.
 */
export function buildTaskGenerationPrompt(
  analysis: ArchitectureAnalysis,
  documentContent: string,
  options: {
    style: string;
    numTasks?: number;
    blueprint?: { blueprint: ApplicationBlueprint; resolved: BlueprintConcern[] };
  },
): ChatCompletionMessage[] {
  const numTasksHint = options.numTasks
    ? `Aim for approximately ${options.numTasks} top-level tasks.`
    : 'Create as many top-level tasks as the architecture naturally supports (typically 5-15).';

  const systemParts = [
    'You are a project planner that converts architecture analysis into structured task hierarchies.',
    '',
    'Return ONLY a JSON object: {"tasks": [...]}',
    'No markdown, no explanation, no code fences.',
    '',
    'Each task object:',
    '  - title: string (concise, actionable)',
    '  - description: string (detailed implementation guidance)',
    '  - type: string ("task")',
    '  - priority: "critical" | "high" | "medium" | "low"',
    '  - dependencies: string[] (titles of other tasks this depends on)',
    '  - requiredSkills: string[] (e.g. "backend", "frontend", "database")',
    '  - tags: string[] (see tagging convention below)',
    '  - children: task[] (same structure, subtask-level items)',
    '',
    'Tagging convention:',
    '  - "component:<name>" — links task to a component (e.g. "component:auth-service")',
    '  - "layer:<layer>" — one of: api, service, domain, data, infra, cli, scripts, tests',
    '  - "concern:<name>" — cross-cutting concern (e.g. "concern:security")',
    '  - "interface:<from>-to-<to>" — interface implementation (e.g. "interface:api-to-auth")',
    '  - "datasource:<name>" — data source setup (e.g. "datasource:users-db")',
    '  - "entrypoint:<category>:<name>" — links task to an entry point (e.g. "entrypoint:http-api:post-login")',
    '  - "side-effect:<type>:<target>" — task involves a side effect (e.g. "side-effect:database-write:sessions")',
    '',
    'Task organization rules:',
    '  1. One top-level task per component (tagged component:<name>, layer:<layer>)',
    '  2. Children break down the component: data layer, business logic, API contracts, integration',
    '  3. Interface tasks as children of the consuming component (tagged interface:<from>-to-<to>)',
    '  4. Data source tasks as children of the owning component (tagged datasource:<name>)',
    '  5. Cross-cutting concern tasks as separate top-level items when spanning 3+ components (tagged concern:<name>)',
    '  6. Dependencies reference other task titles (resolved to IDs post-parse)',
    '',
    'Priority rules:',
    '  - Shared/infra components: critical or high',
    '  - Data layer: high',
    '  - Core business logic: high',
    '  - Integration/API: medium',
    '  - Cross-cutting: medium',
    '  - Docs/polish: low',
    '',
    numTasksHint,
  ];

  // Inject blueprint context when available
  if (options.blueprint) {
    const { blueprint: bp, resolved } = options.blueprint;
    const upfront = resolved.filter((c) => c.urgency === 'upfront');
    const patternFirst = resolved.filter((c) => c.urgency === 'pattern-first');
    const deferred = resolved.filter((c) => c.urgency === 'deferred');

    const blueprintLines = [
      '',
      `=== BLUEPRINT: ${bp.name} ===`,
      'Respect these concern tiers when generating tasks:',
      '',
    ];

    if (upfront.length > 0) {
      blueprintLines.push('UPFRONT (separate tasks, priority critical/high):');
      for (const c of upfront) {
        blueprintLines.push(`- ${c.title}: ${c.implementationGuidance}`);
      }
      blueprintLines.push('');
    }

    if (patternFirst.length > 0) {
      blueprintLines.push('PATTERN-FIRST (placeholder tasks, priority medium):');
      for (const c of patternFirst) {
        blueprintLines.push(`- ${c.title}: ${c.implementationGuidance}`);
      }
      blueprintLines.push('');
    }

    if (deferred.length > 0) {
      blueprintLines.push('DEFERRED (omit unless explicitly in PRD):');
      for (const c of deferred) {
        blueprintLines.push(`- ${c.title}: ${c.implementationGuidance}`);
      }
      blueprintLines.push('');
    }

    blueprintLines.push(`Tag blueprint tasks: blueprint:${bp.id}, urgency:<tier>, concern:<category>`);

    systemParts.push(...blueprintLines);
  }

  const systemContent = systemParts.join('\n');

  const userParts: string[] = [];

  userParts.push('=== ARCHITECTURE ANALYSIS ===');
  userParts.push(JSON.stringify(analysis, null, 2));
  userParts.push('');
  userParts.push('=== ORIGINAL DOCUMENT ===');
  userParts.push(documentContent);

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userParts.join('\n') },
  ];
}
