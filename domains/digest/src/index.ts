/**
 * Digests: periodic, batched, composed messages about the library — as
 * opposed to the one-event-one-send operator telemetry the rest of the
 * notification stack carries.
 *
 * The interesting property is that `buildDigest` reads only the database, so
 * a digest for a past period can be rebuilt exactly, which is how "what did
 * it send me last week" is answerable without having kept the message.
 */
export {
  buildDigest,
  isDigestEmpty,
  tailor,
  DEFAULT_USER_ITEM_CAP,
  type Digest,
  type DigestInput,
  type DigestItem,
} from "./build.ts";
export { renderDigest, type RenderOptions } from "./render.ts";
export {
  claimDelivery,
  completeDelivery,
  releaseDelivery,
  recentDeliveries,
  deliveriesForPeriod,
  lastSentAt,
  SERVER_WIDE_USER_ID,
  type DeliveryKey,
  type DeliveryRow,
  type DeliveryStatus,
} from "./deliveries.ts";
export { periodFor, startOfDay, type DigestFrequency, type DigestPeriod } from "./period.ts";
