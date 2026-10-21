/**
 * What every *Arr router needs: an instance, a client for it, and one place
 * that decides what an upstream failure looks like over the wire.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { errorMessage, type ArrInstance, type ArrInstances } from "@rube/core";
import { createRadarrClient, type RadarrClient } from "@rube/radarr";
import { createSonarrClient, type SonarrClient } from "@rube/sonarr";
import { ARR_SERVICES } from "@rube/contracts";

export const serviceInput = z.object({
  service: z.enum(ARR_SERVICES),
  /** Absent means the service's default instance. */
  instanceId: z.string().optional(),
});

export const instanceInput = z.object({ instanceId: z.string() });

export function createArrClients(arr: ArrInstances) {
  /**
   * The instance a request means.
   *
   * Throws 412 rather than 404 when nothing is configured: an *Arr that has
   * not been set up is a state the user can fix in Settings, not a missing
   * resource — the same reasoning `arr.router.ts` has always used.
   */
  function requireInstance(service: "radarr" | "sonarr", instanceId?: string): ArrInstance {
    const instance = arr.resolveArrInstance(service, instanceId);
    if (!instance) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${service} is not configured` });
    }
    return instance;
  }

  /** Look an instance up by id alone, for the routes scoped to one. */
  function requireInstanceById(instanceId: string): ArrInstance {
    const found = arr.arrInstances().find((i) => i.id === instanceId);
    if (!found) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Unknown instance "${instanceId}"` });
    }
    return found;
  }

  function radarrFor(instance: ArrInstance): RadarrClient {
    return createRadarrClient({ url: instance.url, apiKey: instance.apiKey });
  }

  function sonarrFor(instance: ArrInstance): SonarrClient {
    return createSonarrClient({ url: instance.url, apiKey: instance.apiKey });
  }

  return { requireInstance, requireInstanceById, radarrFor, sonarrFor };
}

/**
 * Run an upstream call, mapping its failure to a gateway error.
 *
 * A `TRPCError` thrown inside (a 412 from `requireInstance`, say) passes
 * through untouched — otherwise "not configured" would be reported as "the
 * upstream is broken", which sends the user looking in the wrong place.
 */
export async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "BAD_GATEWAY", message: errorMessage(err) });
  }
}
