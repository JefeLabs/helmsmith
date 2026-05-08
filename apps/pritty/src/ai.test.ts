import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdapter } from "./ai.js";
import { ConfigSchema } from "./config.js";

/**
 * Provider resolver tests. PRITTY_HOME redirects pritty's
 * ~/.pritty/auth.json so we can simulate having (or not having) a
 * Copilot session. process.env is poked for the Anthropic / OpenAI
 * key vars.
 */

function defaultConfig(overrides: Record<string, unknown> = {}): Parameters<typeof buildAdapter>[0] {
  return ConfigSchema.parse({
    ...overrides,
  });
}

function writeCopilotAuth(home: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({
      version: 1,
      providers: {
        "github-copilot": {
          apiKey: "ghu_fake_for_test",
          scope: "read:user",
          createdAt: new Date().toISOString(),
        },
      },
    }) + "\n",
  );
}

describe("buildAdapter — provider resolution", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pritty-ai-test-"));
    process.env.PRITTY_HOME = tmp;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.PRITTY_HOME;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses copilot when configured and auth.json present", async () => {
    writeCopilotAuth(tmp);
    const adapter = await buildAdapter(defaultConfig());
    expect(adapter).toBeDefined();
    expect(adapter.constructor.name).toBe("CopilotChatAdapter");
  });

  it("uses anthropic when explicitly chosen and key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
    const adapter = await buildAdapter(defaultConfig({ provider: "anthropic" }));
    expect(adapter.constructor.name).toBe("ClaudeSdkAdapter");
  });

  it("uses openai when explicitly chosen and key is set", async () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    const adapter = await buildAdapter(defaultConfig({ provider: "openai" }));
    expect(adapter.constructor.name).toBe("OpenAiChatAdapter");
  });

  it("falls back through the chain when primary unconfigured", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
    // primary copilot has no auth; fallback to anthropic
    const adapter = await buildAdapter(
      defaultConfig({ provider: "copilot", fallback: ["anthropic"] }),
    );
    expect(adapter.constructor.name).toBe("ClaudeSdkAdapter");
  });

  it("walks fallback list in order, picks first available", async () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    // primary copilot, anthropic fallback (no key), openai fallback (key set)
    const adapter = await buildAdapter(
      defaultConfig({
        provider: "copilot",
        fallback: ["anthropic", "openai"],
      }),
    );
    expect(adapter.constructor.name).toBe("OpenAiChatAdapter");
  });

  it("throws a clear error when nothing is configured", async () => {
    await expect(buildAdapter(defaultConfig())).rejects.toThrow(
      /No AI provider available/,
    );
  });

  it("error message lists every provider tried + how to configure it", async () => {
    try {
      await buildAdapter(
        defaultConfig({
          provider: "copilot",
          fallback: ["anthropic", "openai"],
        }),
      );
      throw new Error("expected to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("copilot");
      expect(msg).toContain("anthropic");
      expect(msg).toContain("openai");
      expect(msg).toContain("pritty auth login");
      expect(msg).toContain("ANTHROPIC_API_KEY");
      expect(msg).toContain("OPENAI_API_KEY");
    }
  });

  it("respects custom env-var names", async () => {
    process.env.WORK_ANTHROPIC = "sk-ant-fake";
    const adapter = await buildAdapter(
      defaultConfig({
        provider: "anthropic",
        anthropicKeyEnv: "WORK_ANTHROPIC",
      }),
    );
    expect(adapter.constructor.name).toBe("ClaudeSdkAdapter");
    delete process.env.WORK_ANTHROPIC;
  });

  it("does not fall back when primary is configured", async () => {
    writeCopilotAuth(tmp);
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
    // Primary copilot succeeds → don't even consider fallback
    const adapter = await buildAdapter(
      defaultConfig({ provider: "copilot", fallback: ["anthropic"] }),
    );
    expect(adapter.constructor.name).toBe("CopilotChatAdapter");
  });
});
