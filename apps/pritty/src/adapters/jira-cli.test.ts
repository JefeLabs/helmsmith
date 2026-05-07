import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * jira-cli adapter tests. Mocks node:child_process.execFile via
 * vi.mock so the test controls the binary's responses without
 * actually spawning acli. Note: we use execFile (the safe argv-array
 * variant) throughout — never the shell-interpolating exec().
 */

const mockRunArgs = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: readonly string[],
    optsOrCb: unknown,
    cb?: (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    const callback = (typeof optsOrCb === "function" ? optsOrCb : cb) as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    Promise.resolve(mockRunArgs(cmd, args)).then(
      (result) =>
        callback(null, {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        }),
      (err) => callback(err),
    );
  },
}));

// Import AFTER vi.mock so the mock is in place.
const { JiraCliAdapter } = await import("./jira-cli.js");

describe("JiraCliAdapter", () => {
  beforeEach(() => {
    mockRunArgs.mockReset();
  });

  afterEach(() => {
    mockRunArgs.mockReset();
  });

  it("isAvailable returns true when acli responds to --version", async () => {
    mockRunArgs.mockResolvedValue({ stdout: "acli 2.0.0\n", stderr: "" });
    expect(await new JiraCliAdapter().isAvailable()).toBe(true);
  });

  it("isAvailable returns false when acli is missing", async () => {
    mockRunArgs.mockRejectedValue(new Error("ENOENT"));
    expect(await new JiraCliAdapter().isAvailable()).toBe(false);
  });

  it("returns exists:true with title and status on JSON output", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          key: "PROJ-1",
          summary: "Add SSO support",
          status: { name: "In Progress" },
        }),
        stderr: "",
      });

    const result = await new JiraCliAdapter().validate("PROJ-1");
    expect(result?.exists).toBe(true);
    expect(result?.title).toBe("Add SSO support");
    expect(result?.status).toBe("In Progress");
  });

  it("returns exists:false when stderr contains 'not found'", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: Issue PROJ-999 not found",
      });

    const result = await new JiraCliAdapter().validate("PROJ-999");
    expect(result?.exists).toBe(false);
    expect(result?.error).toContain("PROJ-999");
  });

  it("returns exists:false when subprocess errors with 'not found'", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockRejectedValueOnce(
        Object.assign(new Error("Issue PROJ-999 not found"), {
          stderr: "not found",
        }),
      );

    const result = await new JiraCliAdapter().validate("PROJ-999");
    expect(result?.exists).toBe(false);
  });

  it("returns null on auth errors — fail open", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "unauthorized" });

    const result = await new JiraCliAdapter().validate("PROJ-1");
    expect(result).toBeNull();
  });

  it("returns null when acli is unavailable — fail open", async () => {
    mockRunArgs.mockRejectedValueOnce(new Error("ENOENT"));
    const result = await new JiraCliAdapter().validate("PROJ-1");
    expect(result).toBeNull();
  });

  it("tolerates non-JSON output (returns exists:true without details)", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: "PROJ-1: Add SSO support\nStatus: In Progress\n",
        stderr: "",
      });

    const result = await new JiraCliAdapter().validate("PROJ-1");
    expect(result?.exists).toBe(true);
    expect(result?.title).toBeUndefined();
  });

  it("normalizes status field whether returned as object or string", async () => {
    mockRunArgs
      .mockResolvedValueOnce({ stdout: "acli 2.0.0\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          key: "PROJ-1",
          summary: "x",
          status: "Open",
        }),
        stderr: "",
      });

    const result = await new JiraCliAdapter().validate("PROJ-1");
    expect(result?.status).toBe("Open");
  });
});
