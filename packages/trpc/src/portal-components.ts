/**
 * Which portal components are on, for this server, right now.
 *
 * One function for both sides of the switch: the portal router enforces it and
 * the admin page displays it, so the page can never say a tab is showing that
 * the portal is refusing.
 *
 * The cleanup prerequisite is the `cleanup_enabled` master switch, not
 * `standingRefusal()`. The refusal also fires on a stale library index, which
 * would make the tab vanish between syncs and reappear after — a portal that
 * rearranges itself for reasons no user can see.
 */
import { TRPCError } from "@trpc/server";
import { resolvePortalComponents, type PortalComponentId } from "@rube/contracts";
import type { TrpcDeps } from "./deps.ts";

export function createPortalComponents(deps: Pick<TrpcDeps, "config" | "notifications">) {
  const { getConfig } = deps.config;
  const { smtpConfigured } = deps.notifications;

  function portalComponentStates() {
    return resolvePortalComponents(getConfig("portal_components_hidden") ?? [], {
      cleanup: getConfig("cleanup_enabled") === true,
      smtp: smtpConfigured(),
      match: getConfig("match_enabled") === true,
    });
  }

  function isComponentOn(id: PortalComponentId): boolean {
    return portalComponentStates()[id].on;
  }

  /**
   * Server-side, not only hidden: a switched-off component is one the admin
   * has decided shared users don't get, and a cached tab or a hand-made
   * request shouldn't get round that.
   */
  function requireComponent(id: PortalComponentId): void {
    if (!isComponentOn(id)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This isn't available on this server." });
    }
  }

  return { isComponentOn, portalComponentStates, requireComponent };
}
