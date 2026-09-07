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
  browserIdleMinutes: number; // 0 = never close the idle browser
}

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** Extra readiness condition after Storybook reports the story rendered (Suspense fallbacks). */
export type WaitFor = { selector: string } | { text: string };

export interface Viewport {
  width: number;
  height: number;
}

export interface CheckRequest {
  storyIds?: string[]; // default: every story in the instance
  waitFor?: WaitFor;
  timeoutMs?: number; // per story; default 30000
}

export type CheckStatus = 'pass' | 'fail' | 'timeout';

export interface CheckResult {
  storyId: string;
  status: CheckStatus;
  played: boolean; // a `playing` phase was observed before completion
  durationMs: number;
  error?: { message: string; event: string; stack?: string };
}

export interface CheckResponse {
  instanceId: string;
  results: CheckResult[];
  summary: { pass: number; fail: number; timeout: number };
}

export type ScreenshotClip = 'root' | 'viewport' | 'page';

export interface ScreenshotRequest {
  storyId: string;
  outPath?: string; // absolute; default <configDir>/screenshots/<storyId>-<w>x<h>.png
  viewport?: Viewport; // default 1280x720
  clip?: ScreenshotClip; // default 'root'
  waitFor?: WaitFor;
  timeoutMs?: number; // default 30000
}

export interface ScreenshotResponse {
  instanceId: string;
  storyId: string;
  path: string;
  width: number;
  height: number;
  durationMs: number;
}
