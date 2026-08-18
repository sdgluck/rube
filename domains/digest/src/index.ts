/**
 * Digests: periodic, batched, composed messages about the library — as
 * opposed to the one-event-one-send operator telemetry the rest of the
 * notification stack carries.
 *
 * The interesting property is that `buildDigest` reads only the database, so
 * a digest for a past period can be rebuilt exactly, which is how "what did
 * it send me last week" is answerable without having kept the message.
 * Rendering is pure and stays a module export.
 */
import { token } from "@tinkerbell/container";
import type { Db } from "@tinkerbell/db";
import type { ConfigStore, Sharing } from "@tinkerbell/core";
import type { Cleanup } from "@tinkerbell/domain.cleanup";
import { createBuild } from "./build.ts";
import { createDeliveries } from "./deliveries.ts";
import { createPeriod } from "./period.ts";

export { isDigestEmpty, DEFAULT_USER_ITEM_CAP, type Digest, type DigestInput, type DigestItem } from "./build.ts";
export { renderDigest, type RenderOptions } from "./render.ts";
export { SERVER_WIDE_USER_ID, type DeliveryKey, type DeliveryRow, type DeliveryStatus } from "./deliveries.ts";
export { type DigestFrequency, type DigestPeriod } from "./period.ts";

export interface DigestDeps {
  db: Db;
  config: ConfigStore;
  sharing: Sharing;
  cleanup: Cleanup;
}

export function createDigest(deps: DigestDeps) {
  return {
    ...createBuild(deps),
    ...createDeliveries(deps),
    ...createPeriod(deps),
  };
}

export type Digests = ReturnType<typeof createDigest>;

export const DigestToken = token<Digests>("digest");
