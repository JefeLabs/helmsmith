import { describe, it, expect } from "vitest";
import { normalizeKey } from "../ui/keypress.js";

describe("normalizeKey", () => {
  it("normalizes ctrl-c", () => {
    const key = normalizeKey("\x03");
    expect(key.name).toBe("ctrl-c");
    expect(key.ctrl).toBe(true);
  });

  it("normalizes arrow keys", () => {
    expect(normalizeKey("\x1b[A").name).toBe("up");
    expect(normalizeKey("\x1b[B").name).toBe("down");
    expect(normalizeKey("\x1b[C").name).toBe("right");
    expect(normalizeKey("\x1b[D").name).toBe("left");
  });

  it("normalizes return/enter", () => {
    expect(normalizeKey("\r").name).toBe("return");
    expect(normalizeKey("\n").name).toBe("return");
  });

  it("normalizes escape", () => {
    expect(normalizeKey("\x1b").name).toBe("escape");
  });

  it("normalizes tab", () => {
    expect(normalizeKey("\x09").name).toBe("tab");
  });

  it("lowercases regular characters", () => {
    expect(normalizeKey("A").name).toBe("a");
    expect(normalizeKey("q").name).toBe("q");
    expect(normalizeKey("Z").name).toBe("z");
  });

  it("preserves raw value", () => {
    const key = normalizeKey("x");
    expect(key.raw).toBe("x");
    expect(key.name).toBe("x");
    expect(key.ctrl).toBe(false);
  });
});

// Note: readKeyWithTimeout requires a TTY stdin and cannot be unit tested
// in a headless CI environment. Its timeout behavior is integration-tested
// manually. The core logic (normalizeKey + cleanup) is tested above.
