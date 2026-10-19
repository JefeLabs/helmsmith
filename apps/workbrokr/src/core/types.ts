export type Mode = 'frontend' | 'backend' | 'fullstack';
export type EffortState = 'starting' | 'active' | 'parked' | 'finished';
export type LeaseKind = 'slot' | 'storybook' | 'commons';

export interface ServiceSpec {
  start: string;
  stop: string;
  health: string;
  /** stdout of `health` (trimmed, last token) must be one of these; absent = exit code 0 is healthy */
  healthyCodes?: number[];
  reset?: string;
  /** default 180_000 */
  healthTimeoutMs?: number;
  /** Which slot-bearing modes start this service. Default: ['fullstack'] for 'frontend', else ['backend', 'fullstack']. */
  modes?: ('backend' | 'fullstack')[];
}

export interface RefreshEntry {
  when?: string;
  always?: boolean;
  run?: string;
  mark?: string;
  /** Restore clean `when`-matched files if the refresh command dirties them (default true when `when` is set). */
  restoreWhenIfClean?: boolean;
}

export type ExtraScopesSpec =
  | string[]
  | {
      frontend?: string[];
      backend?: string[];
    };

export interface AreaSpec {
  module?: string;
  commons?: string[];
  extraScopes?: ExtraScopesSpec;
  sharedScopes?: string[];
}

export interface ArchiveSpec {
  paths: string[];
  keepDays: number;
  keepPerArea: number;
}

export interface Manifest {
  project: string;
  baseBranch: string;
  protectedBranches: string[];
  worktreeRoot: string;
  branch: { types: string[] };
  slots: { count: number; reserved: number[] };
  /** slot-0 port per service; slot N = base + N; the project claims [base, base + count) per service */
  ports: { services: Record<string, { base: number }> };
  /** insertion order = start order */
  services: Record<string, ServiceSpec>;
  storybook?: { hostRoot: string };
  logs: { dir: string };
  env: { file: string; template: Record<string, string> };
  seed?: string[];
  refresh: RefreshEntry[];
  scopes: { frontend: string[]; backend: string[] };
  areas: Record<string, AreaSpec>;
  commons: Record<string, string[]>;
  expiry: { slotHours: number; commonsHours: number; storybookHours: number };
  archive: ArchiveSpec;
}

export interface Owner {
  session: string;
  pid: number;
}

export interface Notice {
  from: string;
  text: string;
  at: string;
}

export interface Lease {
  id: string;
  project: string;
  kind: LeaseKind;
  /** slot number, storybrokr instance id, or commons name */
  value: string | number;
  ports?: Record<string, number>;
  /** service → pid this lease started (fullstack): the only processes reap/finish may stop */
  pids?: Record<string, number>;
  /** service → start-time signature of that pid, checked before any signal (pid reuse) */
  signatures?: Record<string, string>;
  owner: Owner;
  effort: string;
  created: string;
  touched: string;
  expires: string;
}

export interface Effort {
  id: string;
  project: string;
  area: string;
  task?: string;
  type: string;
  mode: Mode;
  branch: string;
  worktree: string;
  owner: Owner;
  participants?: Owner[];
  baseSha?: string;
  state: EffortState;
  scopes: string[];
  commons: string[];
  leases: string[];
  notices: Notice[];
  started: string;
  lastActivity: string;
  parkedReason?: string;
  /** The pull request `work pr` opened or adopted for this effort. */
  pr?: { number: number; url: string; draft: boolean };
}

export interface ProjectEntry {
  root: string;
  /** per service: [base, base + count) */
  ranges: Record<string, { base: number; count: number }>;
}

export interface AreaNotice {
  project: string;
  area: string;
  notice: Notice;
}

export interface RegistryFile {
  version: 1;
  projects: Record<string, ProjectEntry>;
  leases: Lease[];
  efforts: Effort[];
  /** informational, per area, kept until the area is retired */
  notices?: AreaNotice[];
}
