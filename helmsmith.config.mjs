// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${PORT_*} are the manifest's own placeholders
// helmsmith.config.mjs — read by `work` (@helmsmith/workbrokr). Written by `work init`, then edited.
// helmsmith efforts are code-only: no services start, so `work start --mode backend` claims a slot
// and starts nothing. Areas are the packages under apps/ and the package groups under platform/;
// docs and changesets are shared by every area. Nothing here is read by the application.
const apps = [
  'gitradar',
  'gittyup',
  'mech-pencil',
  'pritty',
  'storybrokr',
  'taskmaster',
  'timetracker',
  'toolz',
  'workbrokr',
];
const platform = ['context', 'controlplane', 'core', 'harness', 'memory', 'skillzkit'];
const shared = ['docs/**', '.changeset/**', 'README.md', 'pnpm-lock.yaml'];
const area = (module) => ({ module, sharedScopes: shared });

export default {
  project: 'helmsmith',
  baseBranch: 'main',
  protectedBranches: ['main'],
  worktreeRoot: '.claude/worktrees',
  branch: { types: ['feature', 'chore', 'fix'] },
  slots: { count: 10, reserved: [0] },
  ports: { services: {} },
  services: {},
  logs: { dir: '.logs' },
  // A new worktree has no node_modules: install from the lockfile every start.
  refresh: [{ always: true, run: 'pnpm install --frozen-lockfile --prefer-offline' }],
  scopes: {
    frontend: ['{group}/{section}/**'],
    backend: ['{group}/{section}/**'],
  },
  areas: Object.fromEntries([
    ...apps.map((name) => [`apps/${name}`, area(name)]),
    ...platform.map((name) => [`platform/${name}`, area(name)]),
  ]),
  commons: {},
  expiry: { slotHours: 12, commonsHours: 4, storybookHours: 2 },
  archive: { paths: [], keepDays: 30, keepPerArea: 5 },
};
