import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentxTheme, persistAgentxTheme } from './agentx.ts';
import { rosePine, tokyoNight } from './themes/index.ts';

describe('agentx theme loader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentx-theme-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to provided theme when no files exist', () => {
    const { theme, sources } = loadAgentxTheme({
      themeDir: dir,
      fallback: rosePine,
    });
    expect(theme.name).toBe('rose-pine');
    expect(sources).toEqual([]);
  });

  it('loads a flat base16 default.yaml', () => {
    writeFileSync(
      join(dir, 'default.yaml'),
      `scheme: "Tokyo Night"
base00: "1a1b26"
base01: "16161e"
base02: "2f3549"
base03: "444b6a"
base04: "787c99"
base05: "a9b1d6"
base06: "cbccd1"
base07: "d5d6db"
base08: "f7768e"
base09: "ff9e64"
base0A: "e0af68"
base0B: "9ece6a"
base0C: "7dcfff"
base0D: "7aa2f7"
base0E: "bb9af7"
base0F: "cfc9c2"
`,
      'utf8',
    );
    const { theme, sources } = loadAgentxTheme({
      themeDir: dir,
      fallback: rosePine,
    });
    expect(theme.colors.background).toBe('#1a1b26');
    expect(theme.colors.primary).toBe('#7aa2f7');
    expect(sources).toHaveLength(1);
  });

  it('layers a per-app override on top of the default', () => {
    writeFileSync(
      join(dir, 'default.yaml'),
      `scheme: "Rosé Pine"
base00: "191724"
base01: "1f1d2e"
base02: "26233a"
base03: "6e6a86"
base04: "908caa"
base05: "e0def4"
base06: "e0def4"
base07: "524f67"
base08: "eb6f92"
base09: "f6c177"
base0A: "ebbcba"
base0B: "31748f"
base0C: "9ccfd8"
base0D: "c4a7e7"
base0E: "f6c177"
base0F: "524f67"
`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'myapp.yaml'),
      `colors:
  primary: "#ff79c6"
spacing:
  md: 4
`,
      'utf8',
    );
    const { theme, sources } = loadAgentxTheme({
      appName: 'myapp',
      themeDir: dir,
      fallback: rosePine,
    });
    expect(theme.colors.primary).toBe('#ff79c6');
    expect(theme.colors.background).toBe('#191724'); // untouched
    expect(theme.spacing.md).toBe(4);
    expect(theme.spacing.lg).toBe(3); // untouched
    expect(sources).toHaveLength(2);
  });

  it('scopes app overrides — other apps see the unmodified default', () => {
    writeFileSync(
      join(dir, 'default.json'),
      JSON.stringify({
        name: 'rose-pine',
        displayName: 'Rosé Pine',
        appearance: 'dark',
        palette: rosePine.colors.palette,
      }),
      'utf8',
    );
    writeFileSync(
      join(dir, 'myapp.yaml'),
      `colors:
  primary: "#ff79c6"
`,
      'utf8',
    );
    const { theme: myappTheme } = loadAgentxTheme({
      appName: 'myapp',
      themeDir: dir,
      fallback: tokyoNight,
    });
    const { theme: otherTheme } = loadAgentxTheme({
      appName: 'other',
      themeDir: dir,
      fallback: tokyoNight,
    });
    expect(myappTheme.colors.primary).toBe('#ff79c6');
    expect(otherTheme.colors.primary).toBe(rosePine.colors.primary);
  });

  it('persistAgentxTheme writes default.json and removes stale yaml', () => {
    writeFileSync(
      join(dir, 'default.yaml'),
      `scheme: "Old"
base00: "ffffff"
base01: "eeeeee"
base02: "dddddd"
base03: "cccccc"
base04: "bbbbbb"
base05: "444444"
base06: "333333"
base07: "222222"
base08: "cc0000"
base09: "996600"
base0A: "aa9900"
base0B: "008800"
base0C: "007777"
base0D: "000055"
base0E: "660088"
base0F: "660000"
`,
      'utf8',
    );
    persistAgentxTheme(rosePine, { themeDir: dir });
    expect(existsSync(join(dir, 'default.json'))).toBe(true);
    expect(existsSync(join(dir, 'default.yaml'))).toBe(false);
    // Backup preserved
    expect(existsSync(join(dir, 'default.yaml.bak'))).toBe(true);

    const { theme } = loadAgentxTheme({ themeDir: dir, fallback: tokyoNight });
    expect(theme.name).toBe('rose-pine');
  });
});
