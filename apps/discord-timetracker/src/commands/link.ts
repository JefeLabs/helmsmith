/**
 * `link` — map a GitHub username (the `PR Actor:` value in #ci-cd-notifications)
 * to a Discord user, so CI submissions get attributed (feature 5 / M8). Without
 * a link, a CI run can't reach a person — this is how it does.
 *
 * Interactive: picks the Discord user from known members (names captured by the
 * bot) when available, else accepts a pasted user ID.
 */
import { input, select } from '@inquirer/prompts';
import { ConfigError, loadConfig } from '../config/load.js';
import { createStorage } from '../storage/factory.js';

const MANUAL = '__manual__';
const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());
const snowflakeValidator = (v: string) =>
  isSnowflake(v) ? true : 'Enter a Discord user ID (17–20 digits).';

export async function runLink(cwd = process.cwd()): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nRun \`discord-timetracker setup\` first.\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const storage = await createStorage(config.storage);
  try {
    const names = await storage.getUserNames();
    const existing = await storage.listIdentities('github');
    if (existing.length) {
      console.log('\n  Current GitHub → Discord links:');
      for (const l of existing)
        console.log(`    ${l.externalId}  →  ${names[l.userId] ?? l.userId}`);
    }

    const githubUser = (
      await input({
        message: '\n  GitHub username (the "PR Actor" value in #ci-cd-notifications):',
        validate: (v) => (v.trim() ? true : 'A GitHub username is required.'),
      })
    ).trim();

    const knownIds = Object.keys(names);
    let discordId: string;
    if (knownIds.length > 0) {
      const choice = await select({
        message: 'Which Discord user?',
        choices: [
          ...knownIds.map((id) => ({ name: `${names[id]} (${id})`, value: id })),
          { name: 'Enter an ID manually…', value: MANUAL },
        ],
      });
      discordId =
        choice === MANUAL
          ? await input({ message: 'Discord user ID:', validate: snowflakeValidator })
          : choice;
    } else {
      console.log('  (No members seen yet — run the bot a bit, or paste an ID.)');
      discordId = await input({ message: 'Discord user ID:', validate: snowflakeValidator });
    }

    await storage.linkIdentity('github', githubUser, discordId);
    console.log(`\n  ✓ linked GitHub "${githubUser}" → ${names[discordId] ?? discordId}\n`);
  } finally {
    await storage.close();
  }
}
