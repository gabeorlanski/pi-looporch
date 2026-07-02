import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function extensionSessionScope(ctx: ExtensionContext): string {
  return `${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`;
}
