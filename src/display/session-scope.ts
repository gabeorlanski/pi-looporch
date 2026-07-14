/** Provides session scope behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Provides the extensionSessionScope function contract. */
export function extensionSessionScope(ctx: ExtensionContext): string {
  return `${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`;
}
