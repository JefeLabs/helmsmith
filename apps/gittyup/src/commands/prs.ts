import chalk from 'chalk';
import type { Command } from 'commander';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import { GitHubClient } from '../github/client.js';
import type { PrsDocument } from '../output/contract.js';
import { emitJson } from '../output/json.js';

export function registerPrs(program: Command): void {
  program
    .command('prs')
    .description('List open PRs across repos')
    .option('-g, --group <name>', 'Filter by group')
    .option('--json', 'Print { repos: [{ name, prs, error? }] } as one JSON line (all open PRs)')
    .action(async (opts: { group?: string; json?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const repos = opts.group
        ? orchestrator.repos.getReposForTarget(opts.group)
        : orchestrator.repos.getAllRepos();
      const ghRepos = repos.filter((r) => r.url?.includes('github.com'));
      if (ghRepos.length === 0) {
        if (opts.json) return emitJson({ repos: [] } satisfies PrsDocument);
        console.log(chalk.yellow('No repos with GitHub URLs configured.'));
        return;
      }

      const gh = await GitHubClient.create();
      const doc: PrsDocument = { repos: [] };
      for (const repo of ghRepos) {
        try {
          const { owner, repo: repoName } = await gh.getRepoOwner(repo.url!);
          const prs = await gh.listOpenPRs(owner, repoName);
          if (opts.json) {
            doc.repos.push({
              name: repo.name,
              prs: prs.map((pr) => ({
                number: pr.number,
                title: pr.title,
                head: pr.head,
                base: pr.base,
                url: pr.url,
              })),
            });
            continue;
          }
          console.log(chalk.blue.bold(`\n  ${repo.name}`) + chalk.dim(` (${prs.length} open)`));
          for (const pr of prs.slice(0, 10))
            console.log(
              `    #${pr.number} ${pr.title} ${chalk.dim(`(${pr.head} → ${pr.base})`)} ${chalk.blue(pr.url)}`,
            );
        } catch (err: any) {
          if (opts.json) {
            doc.repos.push({ name: repo.name, prs: [], error: err.message });
            continue;
          }
          console.log(chalk.red(`  ${repo.name}: ${err.message}`));
        }
      }
      if (opts.json) return emitJson(doc);
      console.log();
    });
}
