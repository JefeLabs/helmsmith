import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useOnResize, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Catalog } from "../lib/types.js";
import { getInterfaces } from "../lib/interfaces.js";
import { resolveCascade, summarize } from "./state.js";
import { installSelection } from "./install.js";
import { tryReadConfig } from "../lib/init/config.js";
import { SkillzkitApiClient, SkillzkitApiError } from "../lib/api/client.js";
import type { CatalogIndex } from "../lib/api/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPackageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "catalog.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("catalog.json not found from " + __dirname);
}

/**
 * Pad a CatalogIndex (summaries from the API) into a full Catalog
 * shape (with body strings). The TUI's existing rendering code
 * doesn't read the body field, so empty bodies are fine — we only
 * need the shape to satisfy the Catalog type. This adapter lets
 * team mode and standalone mode share the same downstream code.
 */
function indexToCatalog(index: CatalogIndex): Catalog {
  return {
    version: index.version,
    generatedAt: index.generatedAt,
    packageVersion: index.packageVersion,
    commands: index.commands.map((s) => ({ ...s, body: "" })),
    skills: index.skills.map((s) => ({ ...s, body: "" })),
    workflows: index.workflows.map((s) => ({ ...s, body: "" })),
  };
}

// Top-level await on Bun: load the catalog from the right source.
// In standalone mode (or no config), read the bundled catalog.json
// off disk; in team mode, fetch the index from the configured API.
// A failed remote fetch exits the TUI cleanly with a clear remediation
// message — we don't want to drop into an empty TUI and confuse the user.
const config = tryReadConfig();
const targetDir = process.env.SKILLZKIT_TARGET || process.cwd();

let catalog: Catalog;
if (config?.mode === "team") {
  process.stdout.write(
    `Loading catalog from ${config.team.apiUrl}...\n`,
  );
  try {
    const client = new SkillzkitApiClient({ baseUrl: config.team.apiUrl });
    const index = await client.getCatalog();
    catalog = indexToCatalog(index);
  } catch (err) {
    const apiErr = err as SkillzkitApiError;
    process.stderr.write(
      `\n✗ Could not load catalog from ${config.team.apiUrl}\n` +
        `  ${apiErr.message}\n\n` +
        `  Check connectivity, or run \`skillzkit config apiUrl <new-url>\` to fix the URL.\n`,
    );
    process.exit(1);
  }
} else {
  const packageRoot = findPackageRoot();
  catalog = JSON.parse(readFileSync(join(packageRoot, "catalog.json"), "utf8"));
}

type Section = "persona" | "framework" | "integration" | "tool";

interface CatalogItem {
  id: string;
  label: string;
  badge: string;
  section: Section;
  description: string;
  /** Supported invocation interfaces; empty for personas/frameworks. */
  interfaces: string[];
  /** If set, this item is a child of a persona; renders indented in the tree. */
  parentPersonaId?: "product" | "engineer" | "market";
  /** If set, this item is nested under a topic area within a persona. */
  parentTopicId?: string;
  /** If set, this item is a leaf task under a sub-namespace folder
   *  (e.g. product:ux:journeys:map under "subns:product:ux:journeys"). */
  parentSubnamespaceId?: string;
  /** Marks this item as a topic-area aggregator (selecting picks all in it). */
  isTopicArea?: boolean;
  /** Marks this item as a sub-namespace folder (selecting picks all tasks in it). */
  isSubnamespace?: boolean;
  /** Marks this item as a workflow leaf (multi-step orchestrator with
   *  persisted state). Rendered with a `· wf` suffix to distinguish from
   *  one-shot tasks. */
  isWorkflow?: boolean;
}

interface TopicArea {
  id: string;          // "topic:product:strategy"
  label: string;       // "Strategy"
  personaId: "product" | "engineer" | "market";
  prefix: string;      // "product:strategy:" — slugs starting with this belong
  description: string;
}

const TOPIC_AREAS: TopicArea[] = [
  // product
  { id: "topic:product:strategy", label: "Strategy", personaId: "product", prefix: "product:strategy:",
    description: "Briefs, scaffolding, research, editorial style, SEO, brand workflows, token extraction." },
  { id: "topic:product:design", label: "Design", personaId: "product", prefix: "product:design:",
    description: ".pen file design work — foundations (colors/typography/spaces/icons), patterns, page templates." },
  { id: "topic:product:ux", label: "UX", personaId: "product", prefix: "product:ux:",
    description: "Personas (traditional + JTBD), journeys (customer / user-flow / service-blueprint), stories, story maps." },
  // engineer
  { id: "topic:engineer:architecture", label: "Architecture", personaId: "engineer", prefix: "engineer:architecture:",
    description: "ADRs, capability introduction, architecture reviews, C4 diagrams, data models, API contracts, integration patterns." },
  { id: "topic:engineer:maintenance", label: "Maintenance", personaId: "engineer", prefix: "engineer:maintenance:",
    description: "Dependency upgrades by ecosystem (npm/Maven/Gradle/infra), atomic-design / Biome / dedup / Storybook-drift remediation, polyglot cycles." },
  // market
  { id: "topic:market:tone", label: "Tone", personaId: "market", prefix: "market:tone:",
    description: "Brand voice — explore N candidates, refine the established voice, test copy against it." },
  { id: "topic:market:email", label: "Email", personaId: "market", prefix: "market:email:",
    description: "Newsletter, promotional, transactional, welcome, multi-step nurture sequences." },
  { id: "topic:market:ads", label: "Ads", personaId: "market", prefix: "market:ads:",
    description: "Paid search, display, social, video, retargeting, ad–landing pairing." },
  { id: "topic:market:social", label: "Social", personaId: "market", prefix: "market:social:",
    description: "Organic posts on LinkedIn / X / Instagram / Facebook / TikTok plus cross-channel campaign coordination." },
  { id: "topic:market:pr", label: "PR", personaId: "market", prefix: "market:pr:",
    description: "Press releases, downloadable media kit, journalist outreach, newsroom page coordination." },
  { id: "topic:market:workflows", label: "Campaigns", personaId: "market", prefix: "market:workflows:",
    description: "Launch, seasonal, reactivation campaigns plus annual + monthly marketing calendar workflows." },
];

// Interfaces (cli/mcp/rest) live in lib/interfaces.ts so the install
// writes the same data into the runtime manifest the consumer's commands
// read at execution time. The TUI uppercases for display.

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  product:
    "Product strategy, UX research, and visual design as one role — personas, journeys, stories, story maps, design briefs, foundations, patterns, page templates.",
  engineer:
    "Architecture (ADRs, diagrams, data models, API design) and maintenance (dependency upgrades for npm / Maven / Gradle / infra; component remediation).",
  market:
    "Brand voice, email content (newsletter / promo / nurture), ad copy (search / display / social), organic social posts, PR, and campaign coordination.",
};

const FRAMEWORK_DESCRIPTIONS: Record<string, string> = {
  "frameworks:heroui":
    "HeroUI v3 + Tailwind v4 React component generation from Pencil .pen files. Cascade: HeroUI → react-aria-components → react-aria hooks → custom WAI-ARIA.",
  "frameworks:storybook":
    "Storybook story generation, verification (a11y, health, screenshots, interactions), migration, and Chromatic integration health.",
};

function uniqueLeaves(prefix: string): string[] {
  const leaves = new Set<string>();
  for (const cmd of catalog.commands) {
    if (!cmd.slug.startsWith(prefix)) continue;
    const rest = cmd.slug.slice(prefix.length);
    const leaf = rest.split(":")[0];
    if (leaf.startsWith("_")) continue;
    if (leaf === "declare" || leaf === "manifest" || leaf === "setup" || leaf === "credentials") continue;
    leaves.add(leaf);
  }
  return Array.from(leaves).sort();
}

function descFor(slug: string): string {
  const cmd = catalog.commands.find((c) => c.slug === slug);
  return cmd?.description ?? "";
}

function buildPersonaWithTopics(
  personaId: "product" | "engineer" | "market",
  label: string
): CatalogItem[] {
  const items: CatalogItem[] = [];
  const personaCmdCount = catalog.commands.filter(
    (c) => c.slug.startsWith(`${personaId}:`) && c.kind !== "context"
  ).length;
  items.push({
    id: personaId,
    label,
    section: "persona",
    badge: `(${personaCmdCount} items)`,
    description: PERSONA_DESCRIPTIONS[personaId],
    interfaces: [],
  });

  const topics = TOPIC_AREAS.filter((t) => t.personaId === personaId);
  for (const topic of topics) {
    const topicCmds = catalog.commands.filter(
      (c) => c.slug.startsWith(topic.prefix) && c.kind !== "context"
    );
    const topicWorkflows = catalog.workflows.filter((w) =>
      w.commandSlug.startsWith(topic.prefix)
    );
    items.push({
      id: topic.id,
      label: topic.label,
      section: "persona",
      badge: `(${topicCmds.length} items)`,
      description: topic.description,
      interfaces: [],
      parentPersonaId: personaId,
      isTopicArea: true,
    });
    if (topicWorkflows.length > 0) {
      // Topic has workflows — render them as the children (existing
      // behavior). Workflow-rich topics like Strategy, Design,
      // Architecture, Maintenance, Campaigns get this branch.
      for (const wf of topicWorkflows) {
        items.push({
          id: wf.commandSlug,
          // Outcome (action verb + outcome) reads as a runnable thing —
          // "Apply a brand refresh" instead of the slug "brand-refresh".
          // Falls back to the slug when a workflow hasn't declared one yet.
          label: wf.outcome ?? wf.slug,
          section: "persona",
          badge: "",
          description: wf.description || `${personaId}:${wf.slug} workflow`,
          interfaces: [],
          parentPersonaId: personaId,
          parentTopicId: topic.id,
          isWorkflow: true,
        });
      }
    } else {
      // No workflows — surface tasks instead, grouped by sub-namespace
      // (e.g. journeys/, personas/, stories/, story-maps/ under UX) so
      // users can see and pick the underlying primitives. Topics like
      // UX live here.
      const topicSegCount = topic.prefix.split(":").filter(Boolean).length;
      const subnsMap = new Map<string, typeof topicCmds>();
      const directTasks: typeof topicCmds = [];
      for (const cmd of topicCmds) {
        const parts = cmd.slug.split(":");
        if (parts.length === topicSegCount + 1) {
          directTasks.push(cmd);
        } else if (parts.length >= topicSegCount + 2) {
          const key = parts[topicSegCount];
          if (key === "workflows") continue; // already handled above
          if (!subnsMap.has(key)) subnsMap.set(key, []);
          subnsMap.get(key)!.push(cmd);
        }
      }
      for (const [key, tasks] of subnsMap) {
        const subnsId = `subns:${topic.prefix}${key}`;
        const subnsLabel = key
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        items.push({
          id: subnsId,
          label: subnsLabel,
          section: "persona",
          badge: `(${tasks.length} items)`,
          description: SUBNS_DESCRIPTIONS[subnsId] ?? `${tasks.length} tasks under ${topic.label} → ${subnsLabel}.`,
          interfaces: [],
          parentPersonaId: personaId,
          parentTopicId: topic.id,
          isSubnamespace: true,
        });
        for (const task of tasks) {
          items.push({
            id: task.slug,
            label: task.outcome ?? task.slug.split(":").pop()!,
            section: "persona",
            badge: "",
            description: task.description,
            interfaces: [],
            parentPersonaId: personaId,
            parentTopicId: topic.id,
            parentSubnamespaceId: subnsId,
          });
        }
      }
      for (const task of directTasks) {
        items.push({
          id: task.slug,
          label: task.outcome ?? task.slug.split(":").pop()!,
          section: "persona",
          badge: "",
          description: task.description,
          interfaces: [],
          parentPersonaId: personaId,
          parentTopicId: topic.id,
        });
      }
    }
  }
  return items;
}

const SUBNS_DESCRIPTIONS: Record<string, string> = {
  "subns:product:ux:journeys":
    "Customer journeys, user flows, service blueprints, and pain-point tracking across them.",
  "subns:product:ux:personas":
    "Traditional persona definitions and Jobs-to-be-Done statements with priority ranking.",
  "subns:product:ux:stories":
    "User stories with Given/When/Then acceptance criteria and persona/pain-point references.",
  "subns:product:ux:story-maps":
    "Backbone-based story maps anchored to a journey, with release slicing.",
};

const PERSONA_ITEMS: CatalogItem[] = [
  ...buildPersonaWithTopics("product", "Product"),
  ...buildPersonaWithTopics("engineer", "Engineer"),
  ...buildPersonaWithTopics("market", "Market"),
];

const FRAMEWORK_ITEMS: CatalogItem[] = [
  {
    id: "frameworks:heroui",
    label: "HeroUI v3",
    section: "framework",
    badge: "",
    description: FRAMEWORK_DESCRIPTIONS["frameworks:heroui"],
    interfaces: [],
  },
  {
    id: "frameworks:storybook",
    label: "Storybook",
    section: "framework",
    badge: "",
    description: FRAMEWORK_DESCRIPTIONS["frameworks:storybook"],
    interfaces: [],
  },
];

const INTEGRATION_ITEMS: CatalogItem[] = uniqueLeaves("core:integrations:").map((leaf) => ({
  id: `core:integrations:${leaf}`,
  label: leaf,
  section: "integration",
  badge: "",
  description: descFor(`core:integrations:${leaf}`),
  interfaces: getInterfaces(`core:integrations:${leaf}`).map((i) => i.toUpperCase()),
}));

const TOOL_ITEMS: CatalogItem[] = uniqueLeaves("core:tools:").map((leaf) => ({
  id: `core:tools:${leaf}`,
  label: leaf,
  section: "tool",
  badge: "",
  description: descFor(`core:tools:${leaf}`),
  interfaces: getInterfaces(`core:tools:${leaf}`).map((i) => i.toUpperCase()),
}));

const ITEMS: CatalogItem[] = [...PERSONA_ITEMS, ...FRAMEWORK_ITEMS, ...INTEGRATION_ITEMS, ...TOOL_ITEMS];

const SECTION_LABEL: Record<Section, string> = {
  persona: "Personas",
  framework: "Frameworks",
  integration: "Integrations",
  tool: "Tools",
};

type Focus = "search" | "catalog" | "install" | "sync";
type Status = "browsing" | "done" | "synced" | "error";

/**
 * Map a catalog row to the slash command a user would actually type.
 * Returns null for grouping rows (personas, topics) that aren't direct
 * commands themselves — copying their id wouldn't paste into anything
 * useful.
 */
/**
 * Trim text to a length cap, ending on a word boundary when possible and
 * appending an ellipsis. Used to bound the description box so a verbose
 * markdown frontmatter can't push the right column's title off-screen.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max - 30 ? slice.slice(0, lastSpace) : slice) + "…";
}

function commandForItem(item: CatalogItem): string | null {
  if (item.section === "persona" && !item.parentPersonaId) return null; // persona row
  if (item.isTopicArea) return null; // topic aggregator row
  if (item.isSubnamespace) return null; // sub-namespace folder row
  if (item.section === "framework") {
    // framework UI ids are "frameworks:heroui"; the actual command prefix
    // lives under core (e.g., /core:frameworks:heroui:build-components).
    // Copy the namespace so the user can tab-complete from there.
    return `/core:${item.id}`;
  }
  // Workflows, integrations, tools, tasks — id is the real slug
  return `/${item.id}`;
}

type ParentState = "none" | "partial" | "full";

/**
 * For a parent row (persona or topic), report how its workflow-leaf
 * descendants are covered by the current selection. Drives the
 * `[ ] / [o] / [O]` checkbox glyphs that signal partial vs full coverage.
 *
 * Counts only workflow LEAVES (rows the user can individually pick) —
 * empty topics like Design/UX (no workflows under them) report "none"
 * since there's nothing in the tree they can partially cover.
 */
function getParentSelectionState(
  item: CatalogItem,
  picks: Set<string>,
  items: CatalogItem[]
): ParentState {
  let leaves: CatalogItem[];
  if (item.isSubnamespace) {
    // Sub-namespace folder — count its task children
    leaves = items.filter((c) => c.parentSubnamespaceId === item.id);
  } else if (item.isTopicArea) {
    // Topic — count workflow children + task leaves under sub-namespaces
    // belonging to this topic. Sub-namespace folder rows themselves are
    // not leaves, so they're skipped.
    leaves = items.filter(
      (c) => c.parentTopicId === item.id && !c.isSubnamespace,
    );
  } else if (item.section === "persona" && !item.parentPersonaId) {
    // Persona — count all leaves across its topics (excludes the topic
    // and sub-namespace grouping rows themselves).
    leaves = items.filter(
      (c) =>
        c.parentPersonaId === item.id &&
        !!c.parentTopicId &&
        !c.isSubnamespace,
    );
  } else {
    return "none";
  }
  if (leaves.length === 0) return "none";

  let count = 0;
  for (const leaf of leaves) {
    const effective =
      picks.has(leaf.id) ||
      (leaf.parentSubnamespaceId !== undefined && picks.has(leaf.parentSubnamespaceId)) ||
      (leaf.parentTopicId !== undefined && picks.has(leaf.parentTopicId)) ||
      (leaf.parentPersonaId !== undefined && picks.has(leaf.parentPersonaId));
    if (effective) count++;
  }
  if (count === 0) return "none";
  if (count === leaves.length) return "full";
  return "partial";
}

interface FilterResult {
  items: CatalogItem[];
  /** IDs of items whose own text matched — excludes ancestors that came along for context. */
  directMatches: Set<string>;
}

function filterItems(items: CatalogItem[], query: string): FilterResult {
  const q = query.trim().toLowerCase();
  if (!q) return { items, directMatches: new Set() };

  // Group-header rows (personas, topic-area aggregators, sub-namespace
  // folders) are never matched directly — they appear only when one of
  // their descendants matches. This keeps the filter narrow: typing
  // "design" surfaces workflows/integrations whose own text mentions
  // design, not every row in any persona whose description happens to
  // contain the word.
  const isGroupHeader = (item: CatalogItem) =>
    item.isTopicArea ||
    item.isSubnamespace ||
    (item.section === "persona" && !item.parentPersonaId);

  const directMatches = new Set<string>();
  for (const item of items) {
    if (isGroupHeader(item)) continue;
    const haystack = `${item.label} ${item.description} ${item.id}`.toLowerCase();
    if (haystack.includes(q)) directMatches.add(item.id);
  }

  // Pull in each match's ancestors (sub-namespace + topic + persona)
  // so the matched leaf appears anchored in the tree rather than
  // floating.
  const include = new Set<string>(directMatches);
  for (const item of items) {
    if (!directMatches.has(item.id)) continue;
    if (item.parentSubnamespaceId) include.add(item.parentSubnamespaceId);
    if (item.parentTopicId) include.add(item.parentTopicId);
    if (item.parentPersonaId) include.add(item.parentPersonaId);
  }

  return { items: items.filter((item) => include.has(item.id)), directMatches };
}

const App = () => {
  const dims = useTerminalDimensions();
  const renderer = useRenderer();
  // Force a re-render on terminal resize so visibleRows / itemCapacity
  // recompute against the new dims. useTerminalDimensions on its own
  // returns the value but doesn't subscribe to resize events.
  const [, bumpOnResize] = useState(0);
  useOnResize(() => bumpOnResize((n) => n + 1));

  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<Focus>("catalog");
  const [status, setStatus] = useState<Status>("browsing");
  const [resultMsg, setResultMsg] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const resolved = useMemo(() => resolveCascade(picks, catalog), [picks]);
  const summary = useMemo(() => summarize(resolved, catalog), [resolved]);
  const { items: filteredItems, directMatches } = useMemo(
    () => filterItems(ITEMS, searchQuery),
    [searchQuery]
  );
  // Direct-match count rolled up per ancestor — drives filtered badge text
  // on persona/topic rows so "Strategy (8 wf)" becomes "Strategy (3 matching)"
  // when the user has typed a query that narrows the children.
  const matchesPerParent = useMemo(() => {
    const map = new Map<string, number>();
    if (directMatches.size === 0) return map;
    for (const id of directMatches) {
      const item = ITEMS.find((i) => i.id === id);
      if (!item) continue;
      if (item.parentSubnamespaceId)
        map.set(item.parentSubnamespaceId, (map.get(item.parentSubnamespaceId) ?? 0) + 1);
      if (item.parentTopicId) map.set(item.parentTopicId, (map.get(item.parentTopicId) ?? 0) + 1);
      if (item.parentPersonaId) map.set(item.parentPersonaId, (map.get(item.parentPersonaId) ?? 0) + 1);
    }
    return map;
  }, [directMatches]);

  // Refs mirror current state so the keyboard handler reads fresh values
  // even if opentui's useKeyboard captures the callback once per mount.
  const cursorRef = useRef(cursor);
  const focusRef = useRef(focus);
  const filteredItemsRef = useRef(filteredItems);
  cursorRef.current = cursor;
  focusRef.current = focus;
  filteredItemsRef.current = filteredItems;

  // ── windowing math ──
  // Outer chrome that sits ABOVE/BELOW the catalog box's content area:
  //   Banner: 5 ascii + 1 border-bottom + 1 margin-bottom = 7 rows
  //   Search: 1 row + 1 margin-bottom = 2 rows
  //   Outer container padding (top+bottom) = 2 rows
  //   Catalog title row = 1 row
  //   Catalog box top + bottom border = 2 rows
  //   Catalog box top + bottom padding = 2 rows
  //   Total: 16. Subtract from terminal height for inner row budget.
  const visibleRows = Math.max(8, (dims?.height ?? 30) - 16);
  // Within visibleRows we need to fit: 2 always-rendered scroll indicators
  // + section headers + spacers + items. Reserve 2 for indicators; the
  // padding loop fills any remaining rows after sections + items.
  const itemBudget = Math.max(5, visibleRows - 2);
  // Items themselves can occupy at most itemBudget minus typical chrome.
  // Rather than reserve aggressively, allow items to take most of the
  // budget; if an unusually section-heavy view overflows by 1-2 rows,
  // opentui clips gracefully and the user can scroll past the offending
  // section to see remaining items.
  const itemCapacity = Math.max(5, itemBudget - 5);
  const totalCount = filteredItems.length;

  // Edge-triggered scroll: keep the previous offset stable as the cursor
  // moves within the visible window, only adjusting when the cursor would
  // go off-screen. Centering on every keystroke makes the whole list
  // shift one row per arrow press, which feels like jitter.
  const scrollOffsetRef = useRef(0);
  let scrollOffset = scrollOffsetRef.current;
  if (cursor < scrollOffset) scrollOffset = cursor;
  else if (cursor >= scrollOffset + itemCapacity) scrollOffset = cursor - itemCapacity + 1;
  scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalCount - itemCapacity)));
  scrollOffsetRef.current = scrollOffset;

  const scrollEnd = Math.min(scrollOffset + itemCapacity, totalCount);
  const visibleItems = filteredItems.slice(scrollOffset, scrollEnd);

  function doInstall(force: boolean) {
    if (picks.size === 0) {
      setResultMsg("Pick at least one item first.");
      setStatus("error");
      return;
    }
    try {
      const result = installSelection(resolved, catalog, packageRoot, targetDir, { force });
      setResultMsg(
        `${result.installedFiles} files ${force ? "synced" : "installed"}, ${result.skippedExisting} skipped`
      );
      setStatus(force ? "synced" : "done");
    } catch (e) {
      setResultMsg(String(e instanceof Error ? e.message : e));
      setStatus("error");
    }
  }

  useKeyboard((key) => {
    // Quit guard: avoid eating 'q' when search is focused (it'd be a typed char)
    if (key.ctrl && key.name === "c") process.exit(0);
    if (key.name === "q" && focusRef.current !== "search") process.exit(0);

    if (key.name === "tab") {
      setFocus((f) =>
        f === "search" ? "catalog" : f === "catalog" ? "install" : f === "install" ? "sync" : "search"
      );
      return;
    }

    const currentFocus = focusRef.current;
    // Search input owns its own keys via the <input> component's onInput.
    if (currentFocus === "search") return;

    const items = filteredItemsRef.current;
    if (currentFocus === "catalog") {
      if (items.length === 0) return;
      if (key.name === "up" || key.name === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (key.name === "g") {
        setCursor(0);
      } else if (key.name === "G") {
        setCursor(items.length - 1);
      } else if (key.name === "space") {
        const id = items[cursorRef.current]?.id;
        if (!id) return;
        setPicks((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setStatus("browsing");
        setResultMsg("");
      } else if (key.name === "c" || key.name === "y") {
        // Yank (vim-style 'y' or 'c' for copy) the active item's slash
        // command to the system clipboard via OSC52. Works locally and
        // over SSH in OSC52-capable terminals (iTerm2, Kitty, wezterm,
        // Alacritty); silently fails elsewhere — we surface that.
        const item = items[cursorRef.current];
        if (!item) return;
        const cmd = commandForItem(item);
        if (!cmd) {
          setResultMsg(`${item.label} is a grouping, not a command — pick a child row.`);
          setStatus("error");
          return;
        }
        const ok = renderer.copyToClipboardOSC52(cmd);
        setResultMsg(ok ? `Copied ${cmd}` : `Clipboard not supported by this terminal`);
        setStatus(ok ? "done" : "error");
      }
    } else if (currentFocus === "install" && (key.name === "return" || key.name === "space")) {
      doInstall(false);
    } else if (currentFocus === "sync" && (key.name === "return" || key.name === "space")) {
      doInstall(true);
    }
  });

  // Locked items (transitively required by selection)
  const lockedIds = useMemo(() => {
    const locked = new Set<string>();
    for (const item of ITEMS) {
      if (picks.has(item.id)) continue;
      if (["product", "engineer", "market"].includes(item.id)) continue;
      if (item.id.startsWith("frameworks:")) continue;
      if (resolved.locked.has(item.id)) locked.add(item.id);
    }
    return locked;
  }, [picks, resolved]);

  // Build the visible row list. Each row is wrapped in a <box> with
  // flexGrow:1 so opentui clears the row's full horizontal extent on
  // every render. Without the box wrapper, raw <text> elements only
  // write the cells covered by their content; cells past the content
  // length keep stale chars from the previous frame, producing the
  // "Personas" → ">  [ ] Product" leftover-char overlap.
  const visibleRowsRendered: React.ReactNode[] = [];
  let lastSection: Section | null = null;
  visibleItems.forEach((item, idx) => {
    const realIdx = scrollOffset + idx;
    if (item.section !== lastSection) {
      lastSection = item.section;
      if (visibleRowsRendered.length > 0) {
        visibleRowsRendered.push(
          <box key={`sp-${realIdx}`} style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
            <text content=" " />
          </box>
        );
      }
      visibleRowsRendered.push(
        <box key={`hdr-${realIdx}`} style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
          <text content={SECTION_LABEL[item.section]} style={{ fg: "#FFFF00", attributes: 1 }} />
        </box>
      );
    }
    const isSelected = picks.has(item.id);
    const isLocked = lockedIds.has(item.id);
    const isCursor = focus === "catalog" && realIdx === cursor;
    // A nested item is auto-selected if any of its ancestors is picked.
    const isAutoByParent =
      (item.parentSubnamespaceId ? picks.has(item.parentSubnamespaceId) : false) ||
      (item.parentTopicId ? picks.has(item.parentTopicId) : false) ||
      (item.parentPersonaId ? picks.has(item.parentPersonaId) : false);
    const effectivelySelected = isSelected || isAutoByParent;
    const isParentRow =
      item.isTopicArea ||
      item.isSubnamespace ||
      (item.section === "persona" && !item.parentPersonaId);
    // Parent rows show partial vs full coverage of their workflow leaves
    // via [o] (some) / [O] (all) glyphs. Leaves keep [x] (picked) / [*]
    // (auto-locked or transitive). A directly-picked parent counts as full.
    const parentState: ParentState = isParentRow
      ? isSelected
        ? "full"
        : getParentSelectionState(item, picks, ITEMS)
      : "none";
    const checkbox = isParentRow
      ? parentState === "full"
        ? "[O]"
        : parentState === "partial"
        ? "[o]"
        : "[ ]"
      : isAutoByParent || isLocked
      ? "[*]"
      : effectivelySelected
      ? "[x]"
      : "[ ]";
    const cursorMark = isCursor ? "> " : "  ";
    // Indent by depth — 4 levels:
    //   0 = persona, 1 = topic, 2 = workflow OR sub-namespace folder,
    //   3 = task under sub-namespace.
    const depth = item.parentSubnamespaceId
      ? 3
      : item.parentTopicId
      ? 2
      : item.parentPersonaId
      ? 1
      : 0;
    // 2 cells per level keeps the tree readable while preserving ~4 extra
    // cells for workflow names at depth 2.
    const treeIndent = "  ".repeat(depth);
    const fg = isCursor
      ? "#FFFFFF"
      : isParentRow && parentState === "partial"
      ? "#FFAA00"
      : isParentRow && parentState === "full"
      ? "#00FF00"
      : isAutoByParent || isLocked
      ? "#FFAA00"
      : effectivelySelected
      ? "#00FF00"
      : isParentRow || item.isWorkflow
      ? "#AAAAAA" // structure (grouping + workflows): lighter — the
                  // tree skeleton + multi-step orchestrators read as
                  // primary scaffolding
      : "#666666"; // content (tasks + leaf items): darker — recede
                  // as detail until the cursor lands on one
    // Parent rows show a filtered count instead of the static "(N items, M wf)"
    // when a search has narrowed the children below them — gives a true picture
    // of what's actually visible under that branch.
    const filteredBadge =
      isParentRow && searchQuery.trim() && matchesPerParent.has(item.id)
        ? `(${matchesPerParent.get(item.id)} matching)`
        : null;
    const ifaceText =
      filteredBadge ??
      (item.interfaces.length > 0 ? item.interfaces.join(" / ") : item.badge);
    // Workflow rows get a trailing `(w)` so users can tell a multi-step
    // orchestrator from a one-shot task at a glance. Tasks render unmarked.
    const workflowMark = item.isWorkflow ? " (w)" : "";
    // Only pad the label when an iface/badge follows; otherwise let the
    // label flow naturally (workflows have no badge — padding wastes cells).
    const labelText = ifaceText
      ? item.label.padEnd(Math.max(4, 18 - treeIndent.length)) + ifaceText + workflowMark
      : item.label + workflowMark;
    // Two weight tiers: cursor = normal, everything else = DIM. Workflow
    // rows differentiate via a darker fg + the trailing `(w)` marker, not
    // via bold — bold was reading as "loud" against the dim surroundings.
    const attributes = isCursor ? 0 : 2 /* DIM */;
    visibleRowsRendered.push(
      <box key={item.id} style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
        <text
          content={`${cursorMark}${treeIndent}${checkbox} ${labelText}`}
          style={{ fg, attributes }}
        />
      </box>
    );
  });

  // Pad to itemBudget (visibleRows minus the 2 always-rendered indicator
  // rows) so total children inside the catalog box = itemBudget + 2 ≤
  // visibleRows. Empty rows overwrite stale cells from previous frames
  // when the filter shrinks the visible item count.
  while (visibleRowsRendered.length < itemBudget) {
    visibleRowsRendered.push(
      <box key={`pad-${visibleRowsRendered.length}`} style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
        <text content=" " />
      </box>
    );
  }

  const moreAbove = scrollOffset > 0;
  const moreBelow = scrollEnd < totalCount;
  const activeItem = filteredItems[cursor] ?? filteredItems[0] ?? ITEMS[0];
  // Pull tags from the underlying catalog record for the active row.
  // CatalogItem ids match command slugs and skill names (groups have
  // synthetic ids like "topic:..." that won't match — they show no
  // tags, which is correct).
  const activeTags = ((): string[] => {
    const cmd = catalog.commands.find((c) => c.slug === activeItem.id);
    if (cmd?.tags?.length) return cmd.tags;
    const skill = catalog.skills.find((s) => s.name === activeItem.id);
    if (skill?.tags?.length) return skill.tags;
    return [];
  })();

  return (
    // Outer container: drop the all-sides padding that was inheriting 1
    // cell of left offset to every row. Banner now sits flush at column 0,
    // with the banner's own borderBottom acting as the only visual chrome
    // separating it from the rest of the UI.
    <box
      style={{
        flexDirection: "column",
        paddingRight: 1,
        paddingBottom: 1,
        flexGrow: 1,
      }}
    >
      {/* ═══ ROW 1 — banner (no border; marginBottom keeps it visually
          separate from the search row). Explicit height + flexShrink: 0
          prevent the ascii-font from getting recomputed at a different
          row count when the catalog re-renders, which was causing the
          version text aligned to flex-end to jitter vertically as the
          cursor moved. The slick font is 4 rows tall. ═══ */}
      <box
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          marginTop: 2,
          marginBottom: 1,
          height: 4,
          flexShrink: 0,
        }}
      >
        <ascii-font text="SkillzKit" font="slick" fg="#00FFFF" />
        <text content="   " />
        <text content="v0.1.0" style={{ fg: "#888888" }} />
      </box>

      {/* ═══ ROW 2 — search bar (no border; left-aligned with Catalog label) ═══ */}
      <box
        style={{
          flexDirection: "row",
          marginBottom: 1,
          height: 1,
        }}
      >
        <text
          content="Search: "
          style={{ fg: focus === "search" ? "#00FFFF" : "#FFFF00", attributes: 1 }}
        />
        <input
          placeholder="type to filter catalog (workflows, integrations, tools, frameworks)..."
          focused={focus === "search"}
          onInput={(value: string) => {
            setSearchQuery(value);
            setCursor(0);
          }}
          style={{ flexGrow: 1, focusedBackgroundColor: "#000000" }}
        />
      </box>

      {/* ═══ ROW 3 — two columns ═══ */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {/* LEFT — catalog (fills height, scrollable) */}
        <box style={{ flexDirection: "column", flexGrow: 1, marginRight: 2 }}>
          <text
            content={
              searchQuery.trim()
                ? `Catalog  (${directMatches.size} matching "${searchQuery}", ${cursor + 1}/${totalCount} visible)`
                : `Catalog  (${cursor + 1}/${totalCount})`
            }
            style={{ fg: "#FFFF00", attributes: 1 }}
          />
          <box
            style={{
              flexGrow: 1,
              border: true,
              borderColor: focus === "catalog" ? "#00FFFF" : "#444444",
              padding: 1,
              flexDirection: "column",
            }}
          >
            {/* Always render indicator rows so the catalog row count stays
                stable regardless of scroll position. Conditional rendering
                here would shift the items by 1 cell when scrolling reaches
                an edge, displacing rows the user expected to be visible. */}
            <box style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
              <text content={moreAbove ? "  ^ more above" : " "} style={{ fg: "#666666" }} />
            </box>
            {visibleRowsRendered}
            <box style={{ alignSelf: "stretch", height: 1, flexShrink: 0 }}>
              <text content={moreBelow ? "  v more below" : " "} style={{ fg: "#666666" }} />
            </box>
          </box>
        </box>

        {/* RIGHT — description + summary + buttons */}
        <box style={{ flexDirection: "column", width: 40 }}>
          {/* Description of active component — title + id pinned with
              flexShrink: 0 so a long description below can never push them
              off-screen. marginTop on the title gives a row of breathing
              room above so it doesn't sit flush with the column edge. */}
          <box style={{ flexShrink: 0, height: 1, marginTop: 1 }}>
            <text content={activeItem.label} style={{ fg: "#00FFFF", attributes: 1 }} />
          </box>
          <box style={{ flexShrink: 0, height: 1 }}>
            <text content={activeItem.id} style={{ fg: "#666666" }} />
          </box>
          <box
            style={{
              border: true,
              borderColor: "#444444",
              padding: 1,
              flexDirection: "column",
              marginBottom: 1,
              maxHeight: 12,
              flexShrink: 1,
            }}
          >
            <text
              content={truncate(activeItem.description || "(no description)", 220)}
              style={{ fg: "#CCCCCC", attributes: 2 /* DIM */ }}
            />
          </box>

          {/* Tags — orthogonal discovery metadata. Cross-persona/topic
              search axis surfaced inline so users see what topical
              concerns the active artifact carries beyond its position
              in the persona tree. Hidden when no tags. */}
          {activeTags.length > 0 && (
            <box style={{ flexShrink: 0, height: 1, marginBottom: 1 }}>
              <text
                content={`Tags: ${activeTags.join(" · ")}`}
                style={{ fg: "#888888", attributes: 2 /* DIM */ }}
              />
            </box>
          )}

          {/* Selection summary */}
          <text content="Selection summary" style={{ fg: "#FFFF00", attributes: 1 }} />
          <box
            style={{
              border: true,
              borderColor: "#444444",
              padding: 1,
              flexDirection: "column",
              marginBottom: 1,
            }}
          >
            <text content={`Personas:        ${summary.personas}`} style={{ attributes: 2 /* DIM */ }} />
            <text content={`Workflows:       ${summary.workflows}`} style={{ attributes: 2 }} />
            <text content={`Commands:        ${summary.commands}`} style={{ attributes: 2 }} />
            <text content={`Picked items:    ${summary.totalFiles}`} style={{ fg: summary.totalFiles > 0 ? "#00FF00" : "#888888", attributes: 2 }} />
            <text content={`+ infrastructure (audit, workflows, skills)`} style={{ fg: "#888888", attributes: 2 }} />
          </box>

          {/* Target + buttons */}
          <text content={`Target: ${targetDir}/.claude/`} style={{ fg: "#888888" }} />
          <text content="" />
          <box style={{ flexDirection: "row" }}>
            <Button label="Install" focused={focus === "install"} disabled={picks.size === 0} accent="#00FF00" />
            <text content="  " />
            <Button label="Sync" focused={focus === "sync"} disabled={picks.size === 0} accent="#FFAA00" />
          </box>

          {status !== "browsing" && (
            <>
              <text content="" />
              <text
                content={status === "error" ? `✗ ${resultMsg}` : `✓ ${resultMsg}`}
                style={{ fg: status === "error" ? "#FF0000" : "#00FF00" }}
              />
            </>
          )}

          <text content="" />
          <text content="up/down or jk: navigate" style={{ fg: "#666666" }} />
          <text content="g / G: top / bottom" style={{ fg: "#666666" }} />
          <text content="space: toggle / tab: switch focus" style={{ fg: "#666666" }} />
          <text content="c or y: copy slash command" style={{ fg: "#666666" }} />
          <text content="enter: activate button / q: quit" style={{ fg: "#666666" }} />
          <text content="[*] = locked transitive dep" style={{ fg: "#666666" }} />
          <text content="[o] / [O] = partial / full" style={{ fg: "#666666" }} />
        </box>
      </box>
    </box>
  );
};

interface ButtonProps {
  label: string;
  focused: boolean;
  disabled: boolean;
  accent: string;
}

const Button = ({ label, focused, disabled, accent }: ButtonProps) => {
  const fg = disabled ? "#555555" : focused ? "#000000" : accent;
  const bg = focused && !disabled ? accent : undefined;
  return (
    <box style={{ border: true, borderColor: focused ? accent : "#444444", paddingLeft: 2, paddingRight: 2, backgroundColor: bg }}>
      <text content={label} style={{ fg, attributes: focused ? 1 : 0 }} />
    </box>
  );
};

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
