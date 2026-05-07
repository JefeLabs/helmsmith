import { DEFAULT_SETTINGS } from './types/schema.js';
import type { Config, UserWeekRepoRecord } from './types/schema.js';

/**
 * Simple seeded PRNG (mulberry32) for reproducible demo data.
 */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Org / team / member definitions ──────────────────────────────────────────

interface DemoMember {
  name: string;
  email: string;
}

interface DemoTeam {
  name: string;
  tag: string;
  members: DemoMember[];
}

interface DemoOrg {
  name: string;
  type: 'core' | 'consultant';
  teams: DemoTeam[];
}

const DEMO_ORGS: DemoOrg[] = [
  {
    name: 'Acme Corp',
    type: 'core',
    teams: [
      {
        name: 'Platform',
        tag: 'infrastructure',
        members: [
          { name: 'Alice Chen', email: 'alice@acme.com' },
          { name: 'Bob Kumar', email: 'bob@acme.com' },
          { name: 'Carla Diaz', email: 'carla@acme.com' },
          { name: 'Dan Osei', email: 'dan@acme.com' },
        ],
      },
      {
        name: 'Product',
        tag: 'feature',
        members: [
          { name: 'Eva Jones', email: 'eva@acme.com' },
          { name: 'Frank Li', email: 'frank@acme.com' },
          { name: 'Grace Park', email: 'grace@acme.com' },
          { name: 'Hiro Tanaka', email: 'hiro@acme.com' },
        ],
      },
      {
        name: 'Mobile',
        tag: 'feature',
        members: [
          { name: 'Ines Morales', email: 'ines@acme.com' },
          { name: 'Jake Brown', email: 'jake@acme.com' },
          { name: 'Kira Novak', email: 'kira@acme.com' },
        ],
      },
    ],
  },
  {
    name: 'ContractCo',
    type: 'consultant',
    teams: [
      {
        name: 'Frontend Squad',
        tag: 'feature',
        members: [
          { name: 'Leo Garcia', email: 'leo@contractco.com' },
          { name: 'Mia Wong', email: 'mia@contractco.com' },
        ],
      },
      {
        name: 'Data Squad',
        tag: 'analytics',
        members: [
          { name: 'Nina Petrov', email: 'nina@contractco.com' },
          { name: 'Omar Hassan', email: 'omar@contractco.com' },
          { name: 'Priya Sharma', email: 'priya@contractco.com' },
        ],
      },
    ],
  },
];

// ── Repo definitions ─────────────────────────────────────────────────────────

interface DemoRepo {
  name: string;
  group: string;
}

const DEMO_REPOS: DemoRepo[] = [
  { name: 'frontend-app', group: 'web' },
  { name: 'api-server', group: 'backend' },
  { name: 'mobile-ios', group: 'mobile' },
  { name: 'shared-lib', group: 'shared' },
  { name: 'infra-deploy', group: 'infra' },
  { name: 'data-pipeline', group: 'data' },
  { name: 'admin-portal', group: 'web' },
  { name: 'auth-service', group: 'backend' },
];

// ── Team-to-repo affinity (which repos a team mostly works in) ───────────────

const TEAM_REPO_AFFINITY: Record<string, string[]> = {
  Platform: ['api-server', 'shared-lib', 'infra-deploy', 'auth-service'],
  Product: ['frontend-app', 'api-server', 'admin-portal'],
  Mobile: ['mobile-ios', 'shared-lib'],
  'Frontend Squad': ['frontend-app', 'admin-portal'],
  'Data Squad': ['data-pipeline', 'api-server', 'shared-lib'],
};

/**
 * Generate an ISO week string for a given number of weeks before `now`.
 */
function weeksBefore(now: Date, weeksAgo: number): string {
  const d = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  d.setUTCDate(d.getUTCDate() - weeksAgo * 7);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Generate demo data: a Config and an array of UserWeekRepoRecords.
 *
 * @param weeks Number of weeks of history to generate (default: 12)
 * @returns An object with `config` and `records`
 */
export function generateDemoData(weeks: number = 12): {
  config: Config;
  records: UserWeekRepoRecord[];
} {
  const rand = mulberry32(42); // fixed seed for reproducibility
  const now = new Date();

  // Build Config
  const config: Config = {
    repos: DEMO_REPOS.map((r) => ({
      path: `/demo/${r.name}`,
      name: r.name,
      group: r.group,
    })),
    orgs: DEMO_ORGS.map((org) => ({
      name: org.name,
      type: org.type,
      teams: org.teams.map((team) => ({
        name: team.name,
        tag: team.tag,
        members: team.members.map((m) => ({
          name: m.name,
          email: m.email,
          aliases: [],
        })),
      })),
    })),
    groups: {
      web: { label: 'Web' },
      backend: { label: 'Backend' },
      mobile: { label: 'Mobile' },
      shared: { label: 'Shared' },
      infra: { label: 'Infra' },
      data: { label: 'Data' },
    },
    tags: {
      infrastructure: { label: 'Infrastructure' },
      feature: { label: 'Feature' },
      analytics: { label: 'Analytics' },
    },
    settings: { ...DEFAULT_SETTINGS, weeks_back: weeks },
  };

  // Generate records
  const records: UserWeekRepoRecord[] = [];

  for (let w = weeks - 1; w >= 0; w--) {
    const week = weeksBefore(now, w);

    for (const org of DEMO_ORGS) {
      for (const team of org.teams) {
        const affinity = TEAM_REPO_AFFINITY[team.name] ?? [
          DEMO_REPOS[0].name,
        ];

        for (const member of team.members) {
          // Each member works in 1-3 repos per week from their affinity set
          const numRepos = 1 + Math.floor(rand() * Math.min(3, affinity.length));
          const shuffled = [...affinity].sort(() => rand() - 0.5);
          const activeRepos = shuffled.slice(0, numRepos);

          for (const repoName of activeRepos) {
            const repo = DEMO_REPOS.find((r) => r.name === repoName);
            if (!repo) continue;

            // Base commits 3-15 with weekly variation
            const baseCommits = 3 + Math.floor(rand() * 13);
            // Active days 1-5
            const activeDays = 1 + Math.floor(rand() * 5);

            // File type distribution: ~55% app, ~22% test, ~10% config, ~5% storybook, ~8% doc
            const totalFiles = 2 + Math.floor(rand() * 12);
            const appFiles = Math.max(1, Math.round(totalFiles * (0.50 + rand() * 0.15)));
            const testFiles = Math.max(0, Math.round(totalFiles * (0.18 + rand() * 0.1)));
            const configFiles = Math.max(0, Math.round(totalFiles * (0.05 + rand() * 0.1)));
            const docFiles = Math.max(0, Math.round(totalFiles * (0.03 + rand() * 0.1)));
            const storybookFiles = Math.max(0, totalFiles - appFiles - testFiles - configFiles - docFiles);

            // Lines per file: 10-80 insertions, 5-30 deletions
            const insPerFile = 10 + Math.floor(rand() * 70);
            const delPerFile = 5 + Math.floor(rand() * 25);

            // Intent distribution: spread commits across conventional types
            const featCommits = Math.max(0, Math.round(baseCommits * (0.35 + rand() * 0.15)));
            const fixCommits = Math.max(0, Math.round(baseCommits * (0.15 + rand() * 0.10)));
            const refactorCommits = Math.max(0, Math.round(baseCommits * (0.05 + rand() * 0.10)));
            const testCommits = Math.max(0, Math.round(baseCommits * (0.05 + rand() * 0.05)));
            const choreCommits = Math.max(0, Math.round(baseCommits * (0.05 + rand() * 0.05)));
            const docsCommits = Math.max(0, Math.round(baseCommits * (0.02 + rand() * 0.05)));
            const otherCommits = Math.max(0, baseCommits - featCommits - fixCommits - refactorCommits - testCommits - choreCommits - docsCommits);

            // ~8% chance of a breaking change per record, 1-2 breaking commits when it happens
            const breakingChanges = rand() < 0.08 ? 1 + Math.floor(rand() * 2) : 0;

            // Scopes: pick 0-2 from a small set relevant to the repo
            const SCOPE_POOL = ['auth', 'api', 'ui', 'db', 'config', 'ci', 'docs', 'core'];
            const numScopes = Math.floor(rand() * 3);
            const scopes: string[] = [];
            for (let s = 0; s < numScopes; s++) {
              const scope = SCOPE_POOL[Math.floor(rand() * SCOPE_POOL.length)];
              if (!scopes.includes(scope)) scopes.push(scope);
            }

            records.push({
              member: member.name,
              email: member.email,
              org: org.name,
              orgType: org.type,
              team: team.name,
              tag: team.tag,
              week,
              repo: repo.name,
              group: repo.group,
              commits: baseCommits,
              activeDays,
              intent: {
                feat: featCommits,
                fix: fixCommits,
                refactor: refactorCommits,
                docs: docsCommits,
                test: testCommits,
                chore: choreCommits,
                other: otherCommits,
              },
              breakingChanges,
              scopes,
              filetype: {
                app: {
                  files: appFiles,
                  filesAdded: 0,
                  filesDeleted: 0,
                  insertions: appFiles * insPerFile,
                  deletions: appFiles * delPerFile,
                },
                test: {
                  files: testFiles,
                  filesAdded: 0,
                  filesDeleted: 0,
                  insertions: testFiles * Math.round(insPerFile * 0.7),
                  deletions: testFiles * Math.round(delPerFile * 0.5),
                },
                config: {
                  files: configFiles,
                  filesAdded: 0,
                  filesDeleted: 0,
                  insertions: configFiles * Math.round(insPerFile * 0.3),
                  deletions: configFiles * Math.round(delPerFile * 0.3),
                },
                storybook: {
                  files: storybookFiles,
                  filesAdded: 0,
                  filesDeleted: 0,
                  insertions: storybookFiles * Math.round(insPerFile * 0.4),
                  deletions: storybookFiles * Math.round(delPerFile * 0.2),
                },
                doc: {
                  files: docFiles,
                  filesAdded: 0,
                  filesDeleted: 0,
                  insertions: docFiles * Math.round(insPerFile * 0.5),
                  deletions: docFiles * Math.round(delPerFile * 0.3),
                },
              },
            });
          }
        }
      }
    }
  }

  return { config, records };
}
