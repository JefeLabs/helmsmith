/**
 * Resolve the active ticket context from config + branch + history.
 * Used by `pritty commit` and `pritty pr` to thread ticket info into
 * AI-generated content.
 *
 * Resolution chain:
 *   1. Detect from branch name → use silently
 *   2. If `inferFromCommits: true` and no branch ticket: scan recent
 *      commits on this branch
 *      a. If most recent ticket is within `freshWindowHours` → use silently
 *      b. If older than that → prompt y/N (default N) before reusing
 *   3. If `validate: true` and still no ticket → fast-fail
 *   4. Otherwise return whatever ticket was resolved (possibly null)
 */

import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import type { TicketContext } from "../../ai.js";
import {
  buildAdapter,
  deriveLinkTemplate,
  type ValidationResult,
} from "../../adapters/index.js";
import {
  getCachedTicket,
  setCachedTicket,
} from "../../adapters/cache.js";
import { detectTicket, findRecentTicket, ticketLink } from "../../ticket.js";
import { type loadConfig } from "../../config.js";
import { type createGit } from "../../git.js";

export async function resolveTicketContext(
  config: ReturnType<typeof loadConfig>,
  branch: string,
  git: ReturnType<typeof createGit>,
): Promise<TicketContext | undefined> {
  if (!config.ticket) return undefined;

  // 1. Branch-name detection — fastest path, no IO
  let ticket = detectTicket(branch, config.ticket.pattern);

  // 2. Recent-commit fallback (opt-in)
  if (!ticket && config.ticket.inferFromCommits) {
    const commits = await git.recentCommitsOnBranch(20);
    const recent = findRecentTicket(commits, config.ticket.pattern);
    if (recent) {
      const fresh = recent.ageHours <= config.ticket.freshWindowHours;
      if (fresh) {
        ticket = recent.ticket;
        console.log(
          chalk.dim(
            `  (using ${ticket} from recent commit "${recent.fromSubject}", ${formatAge(recent.ageHours)} ago)`,
          ),
        );
      } else {
        const useIt = await confirm({
          message: `Reuse ticket ${recent.ticket} from commit ${formatAge(recent.ageHours)} ago ("${truncateSubject(recent.fromSubject, 50)}")?`,
          default: false,
        });
        if (useIt) ticket = recent.ticket;
      }
    }
  }

  // 3. Validation gate (pattern level)
  if (config.ticket.validate && !ticket) {
    console.error(
      chalk.red(
        `✗ Branch "${branch}" has no ticket reference matching pattern ${config.ticket.pattern}.`,
      ),
    );
    console.error(
      chalk.dim(
        `  Rename your branch to include a ticket (e.g. feature/PROJ-123-foo)`,
      ),
    );
    console.error(
      chalk.dim(`  or set ticket.validate: false in .pritty.json.`),
    );
    process.exit(1);
  }

  // 4. Live validation via adapter (cached). Only fires when both a
  //    ticket is present AND `validation` is configured.
  let title: string | undefined;
  let resolvedLink = ticketLink(ticket, config.ticket.linkTemplate);
  if (ticket && config.ticket.validation) {
    const validation = config.ticket.validation;
    const cached = getCachedTicket(ticket, validation.type);
    let result: ValidationResult | null;
    if (cached) {
      result = {
        exists: cached.exists,
        ...(cached.title ? { title: cached.title } : {}),
        ...(cached.status ? { status: cached.status } : {}),
        ...(cached.url ? { url: cached.url } : {}),
      };
    } else {
      try {
        const adapter = await buildAdapter(validation);
        result = await adapter.validate(ticket);
      } catch (err) {
        console.error(
          chalk.yellow(
            `⚠ Ticket validation failed: ${(err as Error).message}`,
          ),
        );
        result = null;
      }
      if (result) {
        setCachedTicket(ticket, validation.type, {
          exists: result.exists,
          ...(result.title ? { title: result.title } : {}),
          ...(result.status ? { status: result.status } : {}),
          ...(result.url ? { url: result.url } : {}),
        });
      }
    }

    if (result) {
      if (!result.exists && config.ticket.validateStrict) {
        console.error(
          chalk.red(
            `✗ ${ticket} not found in ${validation.type}: ${result.error ?? "ticket missing"}`,
          ),
        );
        console.error(
          chalk.dim(`  Set ticket.validateStrict: false to proceed anyway.`),
        );
        process.exit(1);
      }
      if (!result.exists) {
        console.log(
          chalk.yellow(
            `⚠ ${ticket} not found in ${validation.type}; proceeding anyway.`,
          ),
        );
      } else {
        title = result.title;
        if (result.url) resolvedLink = result.url;
      }
    } else {
      console.log(
        chalk.dim(
          `  (couldn't verify ${ticket} via ${validation.type}; using anyway)`,
        ),
      );
    }
  }

  if (!resolvedLink && config.ticket.validation && ticket) {
    const derived = deriveLinkTemplate(config.ticket.validation);
    resolvedLink = ticketLink(ticket, derived);
  }

  return {
    ticket,
    link: resolvedLink,
    title,
  };
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function truncateSubject(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
