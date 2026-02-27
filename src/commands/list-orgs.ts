import { loadConfig } from '../config/loader.js';

export interface ListOrgsOptions {
  config?: string;
  json?: boolean;
}

export async function listOrgs(options: ListOrgsOptions = {}): Promise<void> {
  let config;
  try {
    config = await loadConfig(options.config);
  } catch {
    console.log('No config found. Run "gitradar add-org" to create one.');
    return;
  }

  if (config.orgs.length === 0) {
    console.log('No organizations configured. Run "gitradar add-org" to create one.');
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(config.orgs, null, 2));
    return;
  }

  for (const org of config.orgs) {
    const typeIcon = org.type === 'core' ? '★' : '◆';
    const idLabel = org.identifier ? ` [identifier: ${org.identifier}]` : '';
    console.log(`\n${typeIcon} ${org.name} (${org.type})${idLabel}`);
    for (const team of org.teams) {
      const tagLabel = team.tag !== 'default' ? ` [${team.tag}]` : '';
      console.log(`  └─ ${team.name}${tagLabel} (${team.members.length} members)`);
      for (const member of team.members) {
        const email = member.email ? ` <${member.email}>` : '';
        const aliases = member.aliases.length > 0 ? ` aliases: ${member.aliases.join(', ')}` : '';
        console.log(`     · ${member.name}${email}${aliases}`);
      }
    }
  }

  const totalTeams = config.orgs.reduce((n, o) => n + o.teams.length, 0);
  const totalMembers = config.orgs.reduce(
    (n, o) => n + o.teams.reduce((m, t) => m + t.members.length, 0),
    0,
  );
  console.log(`\nTotal: ${config.orgs.length} orgs, ${totalTeams} teams, ${totalMembers} members`);
}
