import { loadConfig, saveConfig } from '../config/loader.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import type { Org } from '../types/schema.js';

export interface AddOrgOptions {
  name: string;
  type: 'core' | 'consultant';
  identifier?: string;
  team: string;
  tag?: string;
  config?: string;
}

export async function addOrg(options: AddOrgOptions): Promise<void> {
  let config;
  try {
    config = await loadConfig(options.config);
  } catch {
    config = { repos: [], orgs: [], groups: {}, tags: {}, settings: { ...DEFAULT_SETTINGS } };
  }

  // Check for duplicate org name
  if (config.orgs.some((o) => o.name.toLowerCase() === options.name.toLowerCase())) {
    console.error(`Organization "${options.name}" already exists.`);
    process.exitCode = 1;
    return;
  }

  const newOrg: Org = {
    name: options.name,
    type: options.type,
    identifier: options.identifier,
    teams: [
      {
        name: options.team,
        tag: options.tag ?? 'default',
        members: [],
      },
    ],
  };

  config.orgs.push(newOrg);
  await saveConfig(options.config, { orgs: config.orgs });

  const typeIcon = options.type === 'core' ? '★' : '◆';
  console.log(`Created org: ${typeIcon} ${options.name} (${options.type})`);
  console.log(`  Team: ${options.team}${options.tag ? ` [${options.tag}]` : ''}`);
  if (options.identifier) {
    console.log(`  Identifier prefix: ${options.identifier}`);
  }
}

export interface AddTeamOptions {
  org: string;
  team: string;
  tag?: string;
  config?: string;
}

export async function addTeamToOrg(options: AddTeamOptions): Promise<void> {
  let config;
  try {
    config = await loadConfig(options.config);
  } catch {
    console.error('No config found. Run "gitradar init" first.');
    process.exitCode = 1;
    return;
  }

  const org = config.orgs.find((o) => o.name.toLowerCase() === options.org.toLowerCase());
  if (!org) {
    console.error(`Organization "${options.org}" not found. Run "gitradar org list" to see available orgs.`);
    process.exitCode = 1;
    return;
  }

  if (org.teams.some((t) => t.name.toLowerCase() === options.team.toLowerCase())) {
    console.error(`Team "${options.team}" already exists in ${org.name}.`);
    process.exitCode = 1;
    return;
  }

  org.teams.push({
    name: options.team,
    tag: options.tag ?? 'default',
    members: [],
  });

  await saveConfig(options.config, { orgs: config.orgs });

  const typeIcon = org.type === 'core' ? '★' : '◆';
  console.log(`Added team "${options.team}" to ${typeIcon} ${org.name}`);
  console.log(`  Teams: ${org.teams.map((t) => t.name).join(', ')}`);
}
