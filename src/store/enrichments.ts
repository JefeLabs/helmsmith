import { readFile, writeFile, rename } from "node:fs/promises";
import type {
  EnrichmentStore,
  ProductivityExtensions,
} from "../types/schema.js";
import { getEnrichmentsPath, ensureDataDir } from "./paths.js";

/**
 * Load enrichments from disk, or return an empty default if the file
 * does not exist or cannot be parsed.
 */
export async function loadEnrichments(): Promise<EnrichmentStore> {
  try {
    const raw = await readFile(getEnrichmentsPath(), "utf-8");
    return JSON.parse(raw) as EnrichmentStore;
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      enrichments: {},
    };
  }
}

/**
 * Atomically save enrichments to disk.
 * Updates the lastUpdated timestamp before writing.
 */
export async function saveEnrichments(
  data: EnrichmentStore,
): Promise<void> {
  await ensureDataDir();
  const updated: EnrichmentStore = {
    ...data,
    lastUpdated: new Date().toISOString(),
  };
  const filePath = getEnrichmentsPath();
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Merge a single enrichment entry into the store.
 * Overwrites the existing entry for the same key.
 * Returns a new store; input is not mutated.
 */
export function mergeEnrichment(
  store: EnrichmentStore,
  key: string,
  metrics: ProductivityExtensions,
): EnrichmentStore {
  return {
    ...store,
    enrichments: {
      ...store.enrichments,
      [key]: metrics,
    },
  };
}

/**
 * Look up enrichment data for a given key (member::week::repo).
 * Returns default zeros if not found.
 */
export function getEnrichment(
  store: EnrichmentStore,
  key: string,
): ProductivityExtensions {
  return store.enrichments[key] ?? {
    prs_opened: 0,
    prs_merged: 0,
    avg_cycle_hrs: 0,
    reviews_given: 0,
    churn_rate_pct: 0,
  };
}
