export type InstanceStatus = 'starting' | 'ready' | 'failed' | 'stopped';

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
  url: string; // http://127.0.0.1:<port>/?path=/story/<id>
  iframeUrl: string; // http://127.0.0.1:<port>/iframe.html?id=<id>&viewMode=story
}

export interface InstanceError {
  code: string;
  message: string;
  logTail?: string[];
}

export interface InstanceRecord {
  id: string;
  hostRoot: string;
  component: string; // path relative to hostRoot; dedupe key with hostRoot
  framework: string;
  port: number;
  url: string; // http://127.0.0.1:<port>
  pid: number | null;
  status: InstanceStatus;
  createdAt: string; // ISO
  lastTouchedAt: string; // ISO
  ttlMinutes: number; // 0 = never reap
  storyFiles: string[]; // relative to hostRoot
  stories: StoryEntry[];
  configDir: string; // absolute
  exitCode?: number | null;
  error?: InstanceError;
}

export interface UpRequest {
  component: string;
  hostRoot?: string;
  ttlMinutes?: number;
  wait?: boolean; // default true
}

export interface HostInfo {
  hostRoot: string;
  storybookDir: string; // <hostRoot>/.storybook
  mainFile: string; // absolute
  previewFile: string | null;
  managerFile: string | null;
  framework: string; // e.g. '@storybook/nextjs' or 'unknown'
  storybookBin: string; // <hostRoot>/node_modules/.bin/storybook
  storybookVersion: string;
  tsconfigPaths: Record<string, string[]>;
}

export interface DaemonConfig {
  ttlMinutes: number;
  instanceCap: number;
  portRangeStart: number;
  portRangeEnd: number;
  readinessTimeoutMs: number;
  reaperIntervalMs: number;
  autoStartWaitMs: number;
}

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}
