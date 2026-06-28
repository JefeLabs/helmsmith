/**
 * `Connection` — the contract every connectable resource implements
 * (GitHub Copilot, Anthropic API, GitHub PAT, etc.).
 *
 * Connections are unit-testable in isolation: implement the four
 * methods and ConnectView/StatusList know how to render and drive
 * them. Apps construct Connection objects from their auth library
 * (e.g. `@ecruz165/agent-auth`) and pass an array to `runConnectView`.
 *
 * Design choices:
 * - **Status states**: 3 canonical (connected / expired / disconnected)
 *   plus optional metadata (identity, message). 4 states would be
 *   overkill for current providers; can be added if needed.
 * - **Login progress callback**: optional but recommended. Lets the
 *   TUI stream "Polling for token... (15s left)" updates from a
 *   long-running flow without forcing every flow to.
 * - **Logout returns void**: the caller assumes success-or-throw.
 *   Logout failures are usually network errors that don't change the
 *   user's local state.
 */

export type ConnectionState = 'connected' | 'expired' | 'disconnected';

export interface ConnectionStatus {
  state: ConnectionState;
  /** Logged-in identity if known (e.g. a GitHub username). */
  identity?: string;
  /** Free-form short message. Shown next to the state in the UI. */
  message?: string;
}

export type ProgressCallback = (message: string) => void;

export interface Connection {
  /** Stable id, used as a key in registry/auth storage. */
  id: string;
  /** Human-readable name. Shown in the UI. */
  displayName: string;
  /** Optional one-line description. Shown as subtle text. */
  description?: string;
  /** Read current state. Should be cheap to call (cache if needed). */
  getStatus(): Promise<ConnectionStatus>;
  /** Run the login flow. The optional progress callback receives
   *  status messages the TUI can render (e.g. "User code: ABCD-1234"). */
  login(progress?: ProgressCallback): Promise<ConnectionStatus>;
  /** Revoke / clear local credentials. Throws on hard failure. */
  logout(): Promise<void>;
}

/**
 * Helper for tests + apps that need a no-op connection (e.g. a
 * placeholder until the real auth lib lands).
 */
export function noopConnection(opts: {
  id: string;
  displayName: string;
  description?: string;
  state?: ConnectionState;
}): Connection {
  return {
    id: opts.id,
    displayName: opts.displayName,
    description: opts.description,
    async getStatus() {
      return { state: opts.state ?? 'disconnected' };
    },
    async login() {
      throw new Error(
        `${opts.id}: login() not implemented — replace this noop with a real Connection.`,
      );
    },
    async logout() {
      /* no-op */
    },
  };
}
