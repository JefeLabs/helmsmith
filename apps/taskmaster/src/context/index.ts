import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_GROUP_INITIALS, APP_NAME } from '../config/branding.js';

// ── Types ────────────────────────────────────────────────────

export interface InstructionFile {
  /** Short identifier (e.g., 'team-lead'). */
  id: string;
  /** Human-readable label for display in prompts. */
  label: string;
  /** Source filename in the bundled agents directory. */
  filename: string;
  /** Brief description of the agent role. */
  description: string;
  /** Tools the agent needs (used in Claude Code frontmatter). */
  tools: string[];
}

/** AI coding tools that have distinct instruction file conventions. */
export type AITooling = 'claude-code' | 'copilot' | 'codex';

export interface InstallResult {
  /** Files written, as paths relative to the repo root. */
  files: string[];
  /** The AI tooling format used. */
  tooling: AITooling;
}

// ── Registry ─────────────────────────────────────────────────

export const INSTRUCTION_FILES: InstructionFile[] = [
  {
    id: 'team-lead',
    label: 'Team Lead',
    filename: 'team-lead.md',
    description: 'Orchestrates the task pipeline, delegates work, tracks progress',
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
  },
  {
    id: 'developer',
    label: 'Developer',
    filename: 'developer.md',
    description: 'Picks up tasks, implements, runs tests, marks complete',
    tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  },
  {
    id: 'qa-lead',
    label: 'QA Lead',
    filename: 'qa-lead.md',
    description: 'Tests completed work, reports failures, clears reviews',
    tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  },
];

export const AI_TOOLING_CHOICES: Array<{ label: string; value: AITooling; description: string }> = [
  {
    label: 'Anthropic Claude Code',
    value: 'claude-code',
    description: `Installs agents to .claude/agents/ and commands to .claude/commands/${APP_GROUP_INITIALS}/${APP_NAME}/`,
  },
  {
    label: 'GitHub Copilot',
    value: 'copilot',
    description: 'Installs instructions to .github/instructions/ and prompts to .github/prompts/',
  },
  {
    label: 'OpenAI Codex',
    value: 'codex',
    description: 'Installs agents and commands to AGENTS.md at project root',
  },
];

// ── Bundled file resolution ──────────────────────────────────

/**
 * Resolve the directory containing bundled context files.
 * Works from dev (src/), bundled (dist/cli.js), and non-bundled dist.
 */
function getContextDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = join(currentFile, '..');

  const candidates = [
    currentDir,
    join(currentDir, '..', 'src', 'context'),
    join(currentDir, '..', '..', 'src', 'context'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'agents', 'team-lead.md'))) {
      return candidate;
    }
  }

  throw new Error(
    `Context directory not found. Searched:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

/** Read the raw content of a bundled agent context file. */
export function readAgentContext(id: string): string {
  const entry = INSTRUCTION_FILES.find((f) => f.id === id);
  if (!entry) {
    throw new Error(`Unknown agent context file: ${id}`);
  }
  const filePath = join(getContextDir(), 'agents', entry.filename);
  if (!existsSync(filePath)) {
    throw new Error(`Agent context file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/** Read the raw content of a bundled command file. */
function readCommand(filename: string): string {
  const filePath = join(getContextDir(), 'commands', filename);
  if (!existsSync(filePath)) {
    throw new Error(`Command file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/** List all bundled command filenames. */
function listCommandFiles(): string[] {
  const commandsDir = join(getContextDir(), 'commands');
  if (!existsSync(commandsDir)) return [];
  return readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

// ── Tool-specific adapters: agents ───────────────────────────

function wrapAgentForClaudeCode(id: string, content: string, meta: InstructionFile): string {
  return [
    '---',
    `name: taskmaster-${id}`,
    `description: "${meta.description}"`,
    `tools: ${meta.tools.join(', ')}`,
    '---',
    '',
    content,
  ].join('\n');
}

function wrapAgentForCopilot(_id: string, content: string, meta: InstructionFile): string {
  return [
    '---',
    `name: 'Taskmaster ${meta.label}'`,
    `description: '${meta.description}'`,
    '---',
    '',
    content,
  ].join('\n');
}

// ── Tool-specific adapters: commands ─────────────────────────

function wrapCommandForCopilotPrompt(filename: string, content: string): string {
  const lines = content.split('\n');
  const name = filename.replace('.md', '');
  const descLine = lines.find(
    (l, i) => i > 0 && l.trim().length > 0 && !l.startsWith('Arguments:'),
  );
  const description = descLine?.trim() || name;

  return ['---', `description: '${description}'`, '---', '', content].join('\n');
}

function buildAgentsMd(ids: string[], includeCommands: boolean): string {
  const sections: string[] = [
    '# Taskmaster Agent Instructions',
    '',
    'This project uses Taskmaster for task management.',
    'Use `npx taskmaster` to interact with the task pipeline.',
    '',
  ];

  // Agent roles
  for (const id of ids) {
    const content = readAgentContext(id);
    sections.push(content);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  // Commands reference
  if (includeCommands) {
    const commandFiles = listCommandFiles();
    if (commandFiles.length > 0) {
      sections.push('# Command Reference');
      sections.push('');
      for (const filename of commandFiles) {
        const content = readCommand(filename);
        sections.push(content);
        sections.push('');
        sections.push('---');
        sections.push('');
      }
    }
  }

  return `${sections.join('\n').trimEnd()}\n`;
}

// ── Installation ─────────────────────────────────────────────

/**
 * Install agent context files and commands into a project,
 * formatted for the specified AI coding tool.
 *
 * @param repoRoot — The project/repository root directory.
 * @param ids      — Which agent roles to install (e.g., ['team-lead', 'developer']).
 * @param tooling  — Which AI coding tool convention to use.
 * @returns Paths of files written, relative to repoRoot.
 */
export async function installContext(
  repoRoot: string,
  ids: string[],
  tooling: AITooling,
): Promise<InstallResult> {
  const files: string[] = [];
  const commandFiles = listCommandFiles();

  switch (tooling) {
    case 'claude-code': {
      // Install agents to .claude/agents/
      const agentsDir = join(repoRoot, '.claude', 'agents');
      await mkdir(agentsDir, { recursive: true });

      for (const id of ids) {
        const meta = INSTRUCTION_FILES.find((f) => f.id === id)!;
        const content = readAgentContext(id);
        const wrapped = wrapAgentForClaudeCode(id, content, meta);
        const filename = `taskmaster-${id}.md`;
        await writeFile(join(agentsDir, filename), wrapped, 'utf-8');
        files.push(`.claude/agents/${filename}`);
      }

      // Install commands to .claude/commands/{APP_GROUP}/{APP_NAME}/
      if (commandFiles.length > 0) {
        const commandsDir = join(repoRoot, '.claude', 'commands', APP_GROUP_INITIALS, APP_NAME);
        await mkdir(commandsDir, { recursive: true });

        for (const filename of commandFiles) {
          const content = readCommand(filename);
          await writeFile(join(commandsDir, filename), content, 'utf-8');
          files.push(`.claude/commands/${APP_GROUP_INITIALS}/${APP_NAME}/${filename}`);
        }
      }
      break;
    }

    case 'copilot': {
      // Install agents to .github/instructions/
      const instructionsDir = join(repoRoot, '.github', 'instructions');
      await mkdir(instructionsDir, { recursive: true });

      for (const id of ids) {
        const meta = INSTRUCTION_FILES.find((f) => f.id === id)!;
        const content = readAgentContext(id);
        const wrapped = wrapAgentForCopilot(id, content, meta);
        const filename = `taskmaster-${id}.instructions.md`;
        await writeFile(join(instructionsDir, filename), wrapped, 'utf-8');
        files.push(`.github/instructions/${filename}`);
      }

      // Install commands as Copilot prompt files (.prompt.md)
      // Prefix with "taskmaster-" for grouping: /taskmaster-next, /taskmaster-list, etc.
      if (commandFiles.length > 0) {
        const promptsDir = join(repoRoot, '.github', 'prompts');
        await mkdir(promptsDir, { recursive: true });

        for (const filename of commandFiles) {
          const name = filename.replace('.md', '');
          const content = readCommand(filename);
          const wrapped = wrapCommandForCopilotPrompt(filename, content);
          const promptFilename = `taskmaster-${name}.prompt.md`;
          await writeFile(join(promptsDir, promptFilename), wrapped, 'utf-8');
          files.push(`.github/prompts/${promptFilename}`);
        }
      }
      break;
    }

    case 'codex': {
      const agentsMdPath = join(repoRoot, 'AGENTS.md');
      let existing = '';

      try {
        existing = await readFile(agentsMdPath, 'utf-8');
      } catch {
        // No existing file
      }

      const taskmasterSection = buildAgentsMd(ids, true);

      if (existing && !existing.includes('# Taskmaster Agent Instructions')) {
        const combined = `${existing.trimEnd()}\n\n${taskmasterSection}`;
        await writeFile(agentsMdPath, combined, 'utf-8');
      } else {
        await writeFile(agentsMdPath, taskmasterSection, 'utf-8');
      }

      files.push('AGENTS.md');
      break;
    }
  }

  return { files, tooling };
}
