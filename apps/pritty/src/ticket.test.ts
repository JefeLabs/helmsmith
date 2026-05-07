import { describe, expect, it } from "vitest";
import { detectTicket, ticketLink, ticketPromptGuidance } from "./ticket.js";

describe("detectTicket", () => {
  it("finds Jira-style tickets in branch names", () => {
    expect(detectTicket("feature/PROJ-123-add-login", "[A-Z]+-\\d+")).toBe("PROJ-123");
  });

  it("returns null when pattern doesn't match", () => {
    expect(detectTicket("feature/add-login", "[A-Z]+-\\d+")).toBeNull();
  });

  it("uppercases lowercase ticket matches", () => {
    expect(detectTicket("feature/proj-456-foo", "[A-Z]+-\\d+")).toBe("PROJ-456");
  });

  it("supports custom patterns (Linear-style)", () => {
    expect(detectTicket("eng-789/payment-flow", "ENG-\\d+")).toBe("ENG-789");
  });

  it("returns null on empty branch", () => {
    expect(detectTicket("", "[A-Z]+-\\d+")).toBeNull();
  });

  it("returns null on malformed regex (fails closed)", () => {
    expect(detectTicket("feature/PROJ-123", "[invalid regex (")).toBeNull();
  });

  it("returns the first match when branch contains multiple tickets", () => {
    expect(detectTicket("PROJ-1-and-PROJ-2", "[A-Z]+-\\d+")).toBe("PROJ-1");
  });
});

describe("ticketLink", () => {
  it("substitutes {ticket} into the template", () => {
    expect(
      ticketLink("PROJ-123", "https://yourorg.atlassian.net/browse/{ticket}"),
    ).toBe("https://yourorg.atlassian.net/browse/PROJ-123");
  });

  it("returns undefined when no template", () => {
    expect(ticketLink("PROJ-123", undefined)).toBeUndefined();
  });

  it("returns undefined when ticket is null", () => {
    expect(ticketLink(null, "https://x/{ticket}")).toBeUndefined();
  });

  it("substitutes multiple {ticket} occurrences", () => {
    expect(ticketLink("PROJ-1", "{ticket}/edit/{ticket}")).toBe(
      "PROJ-1/edit/PROJ-1",
    );
  });
});

describe("ticketPromptGuidance", () => {
  it("returns empty string when no ticket", () => {
    expect(ticketPromptGuidance(null, undefined)).toBe("");
  });

  it("includes the ticket reference", () => {
    const guidance = ticketPromptGuidance("PROJ-123", undefined);
    expect(guidance).toContain("PROJ-123");
    expect(guidance).toContain("Refs: PROJ-123");
  });

  it("includes the link when provided", () => {
    const guidance = ticketPromptGuidance("PROJ-123", "https://x/PROJ-123");
    expect(guidance).toContain("https://x/PROJ-123");
  });
});
