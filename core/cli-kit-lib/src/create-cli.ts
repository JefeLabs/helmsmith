import { Command } from 'commander';
import type { AuthProvider } from './auth-provider.js';
import { noopAuthProvider } from './auth-provider.js';

export interface CreateCliOptions {
  /** CLI binary name as it appears in `--help` and version output. */
  name: string;
  /** Semver version, usually read from the consumer's package.json. */
  version: string;
  /** One-line description shown in `--help`. */
  description?: string;
  /**
   * Auth provider injected by the consumer. Available to action
   * handlers via `program.getOptionValue("_auth")` or by closing over
   * the returned reference. Defaults to a no-op that throws on use.
   */
  auth?: AuthProvider;
}

export interface Cli {
  /** The configured commander Program. Register subcommands on it. */
  program: Command;
  /** The AuthProvider passed in (or the no-op default). */
  auth: AuthProvider;
}

/**
 * Bootstrap a commander Program with conventions shared across the
 * AgentX ecosystem: name, version, description, error formatting,
 * and a hook to access the consumer's auth provider.
 *
 * Usage:
 *
 * ```ts
 * const { program, auth } = createCli({
 *   name: "pritty",
 *   version: VERSION,
 *   auth: agentAuthProvider,
 * });
 * program.command("commit").action(async () => {
 *   const token = await auth.getToken();
 *   // ...
 * });
 * program.parse();
 * ```
 */
export function createCli(opts: CreateCliOptions): Cli {
  const program = new Command();
  program.name(opts.name).version(opts.version);
  if (opts.description) program.description(opts.description);

  // Standardize error output across the ecosystem: print to stderr,
  // exit non-zero, no commander's default "error: ..." prefix that
  // some users find noisy. Consumers can override with their own
  // .exitOverride() if needed.
  program.configureOutput({
    outputError: (str, write) => write(str),
  });

  return { program, auth: opts.auth ?? noopAuthProvider };
}
