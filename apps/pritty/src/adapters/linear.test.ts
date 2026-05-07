import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearAdapter } from "./linear.js";

describe("LinearAdapter", () => {
  const config = {
    type: "linear" as const,
    apiKeyEnv: "LINEAR_API_KEY",
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    process.env.LINEAR_API_KEY = "lin_api_key";
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
    globalThis.fetch = originalFetch;
  });

  it("isAvailable is true when API key env is set", async () => {
    expect(await new LinearAdapter(config).isAvailable()).toBe(true);
  });

  it("isAvailable is false when API key env is missing", async () => {
    delete process.env.LINEAR_API_KEY;
    expect(await new LinearAdapter(config).isAvailable()).toBe(false);
  });

  it("returns exists:true with title/status/url on found issue", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issue: {
            identifier: "ENG-123",
            title: "Add SSO support",
            url: "https://linear.app/yourorg/issue/ENG-123",
            state: { name: "In Progress" },
          },
        },
      }),
    } as Response);

    const result = await new LinearAdapter(config).validate("ENG-123");
    expect(result?.exists).toBe(true);
    expect(result?.title).toBe("Add SSO support");
    expect(result?.status).toBe("In Progress");
    expect(result?.url).toBe("https://linear.app/yourorg/issue/ENG-123");
  });

  it("returns exists:false when GraphQL returns null issue", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { issue: null } }),
    } as Response);

    const result = await new LinearAdapter(config).validate("ENG-999");
    expect(result?.exists).toBe(false);
    expect(result?.error).toContain("ENG-999");
  });

  it("returns null on GraphQL errors — fail open", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Authentication failed" }],
      }),
    } as Response);

    const result = await new LinearAdapter(config).validate("ENG-1");
    expect(result).toBeNull();
  });

  it("returns null on non-200 response — fail open", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    const result = await new LinearAdapter(config).validate("ENG-1");
    expect(result).toBeNull();
  });

  it("returns null on network error — fail open", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ENETUNREACH"));
    const result = await new LinearAdapter(config).validate("ENG-1");
    expect(result).toBeNull();
  });

  it("returns null when API key is missing", async () => {
    delete process.env.LINEAR_API_KEY;
    const result = await new LinearAdapter(config).validate("ENG-1");
    expect(result).toBeNull();
  });

  it("sends Authorization header without Bearer prefix (Linear convention)", async () => {
    let capturedAuth: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(((_url: string, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { issue: null } }),
      } as Response);
    }) as typeof fetch);

    await new LinearAdapter(config).validate("ENG-1");
    expect(capturedAuth).toBe("lin_api_key");
    expect(capturedAuth).not.toContain("Bearer");
  });
});
