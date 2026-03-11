import { describe, it, expect } from "vitest";
import type { EnrichmentStore, ProductivityExtensions } from "../types/schema.js";
import { mergeEnrichment, getEnrichment } from "../store/enrichments.js";

function makeStore(entries?: Record<string, ProductivityExtensions>): EnrichmentStore {
  return {
    version: 1,
    lastUpdated: "2026-03-10T00:00:00Z",
    enrichments: entries ?? {},
  };
}

const sampleMetrics: ProductivityExtensions = {
  prs_opened: 3,
  prs_merged: 2,
  avg_cycle_hrs: 18.5,
  reviews_given: 5,
  churn_rate_pct: 15,
};

describe("mergeEnrichment", () => {
  it("adds a new entry to an empty store", () => {
    const store = makeStore();
    const result = mergeEnrichment(store, "alice::2026-W10::frontend", sampleMetrics);

    expect(result.enrichments["alice::2026-W10::frontend"]).toEqual(sampleMetrics);
  });

  it("overwrites an existing entry", () => {
    const store = makeStore({
      "alice::2026-W10::frontend": {
        prs_opened: 1,
        prs_merged: 1,
        avg_cycle_hrs: 10,
        reviews_given: 2,
        churn_rate_pct: 5,
      },
    });

    const result = mergeEnrichment(store, "alice::2026-W10::frontend", sampleMetrics);
    expect(result.enrichments["alice::2026-W10::frontend"]).toEqual(sampleMetrics);
  });

  it("does not mutate the input store", () => {
    const store = makeStore();
    mergeEnrichment(store, "alice::2026-W10::frontend", sampleMetrics);

    expect(store.enrichments["alice::2026-W10::frontend"]).toBeUndefined();
  });

  it("preserves other entries when adding new one", () => {
    const store = makeStore({
      "bob::2026-W10::backend": {
        prs_opened: 2,
        prs_merged: 1,
        avg_cycle_hrs: 24,
        reviews_given: 3,
        churn_rate_pct: 10,
      },
    });

    const result = mergeEnrichment(store, "alice::2026-W10::frontend", sampleMetrics);
    expect(result.enrichments["bob::2026-W10::backend"]).toBeDefined();
    expect(result.enrichments["alice::2026-W10::frontend"]).toBeDefined();
  });
});

describe("getEnrichment", () => {
  it("returns metrics for an existing key", () => {
    const store = makeStore({
      "alice::2026-W10::frontend": sampleMetrics,
    });

    const result = getEnrichment(store, "alice::2026-W10::frontend");
    expect(result).toEqual(sampleMetrics);
  });

  it("returns zeros for a missing key", () => {
    const store = makeStore();
    const result = getEnrichment(store, "nobody::2026-W10::frontend");

    expect(result).toEqual({
      prs_opened: 0,
      prs_merged: 0,
      avg_cycle_hrs: 0,
      reviews_given: 0,
      churn_rate_pct: 0,
    });
  });
});
