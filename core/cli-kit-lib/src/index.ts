/**
 * @ecruz165/cli-kit — shared CLI bootstrap for the AgentX ecosystem.
 *
 * Public surface:
 *   - createCli({ name, version, auth }) → { program, auth }
 *   - AuthProvider interface for consumers to implement
 *   - inquirer is a peer dep — import it directly in consumers
 */
export { createCli } from "./create-cli.js";
export type { Cli, CreateCliOptions } from "./create-cli.js";
export type { AuthProvider } from "./auth-provider.js";
export { noopAuthProvider } from "./auth-provider.js";
