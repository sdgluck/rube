/**
 * The message shape every sender speaks, and the event vocabulary users
 * subscribe to.
 */

export const NOTIFICATION_SERVICES = [
  "pushover",
  "discord",
  "gotify",
  "lunasea",
  "pushbullet",
  "slack",
  "telegram",
  "webhook",
  "smtp",
] as const;

export type NotificationService = (typeof NOTIFICATION_SERVICES)[number];

/**
 * Every event a user can subscribe a service to.
 *
 * Two audiences share this list. Most of it is **operator telemetry** — job
 * and health events that answer "is Tinkerbell working". The library events
 * (`media.added`, `collection.created`) are the other kind: they're about the
 * server rather than the app, and they're what a digest is built from.
 *
 * The Settings UI derives its checkbox list from this array, so adding an
 * entry here is the whole of the plumbing.
 */
export const EVENT_TYPES = [
  { id: "job.completed", label: "Job Completed" },
  { id: "job.failed", label: "Job Failed" },
  { id: "health.failed", label: "Health Check Failed" },
  { id: "health.recovered", label: "Health Check Recovered" },
  // Separate from `health.failed` because it is the one outage that stops
  // everything — most people want it routed somewhere noisier than a *Arr
  // going quiet. Emitted *alongside* `health.failed`, not instead of it, so
  // an existing subscription keeps behaving exactly as it did.
  { id: "plex.unreachable", label: "Plex Unreachable" },
  { id: "bandwidth.tested", label: "Bandwidth Tested" },
  // `cleanup.pending` is the one that matters: a message saying "these six
  // films go tomorrow unless you keep them" is what turns an automated
  // deletion from frightening into routine.
  { id: "cleanup.pending", label: "Cleanup Pending" },
  { id: "cleanup.actioned", label: "Cleanup Actioned" },
  // Metadata writes are the one thing in the app that cannot be regenerated,
  // so a run that changed something says so — the event carries the batch id,
  // which is what an undo needs.
  { id: "metadata.written", label: "Metadata Written" },
  // One event per sync, not one per item: a library scan that finds 127 new
  // files should be one ping, and the count plus a few titles is what anyone
  // reads anyway.
  { id: "media.added", label: "Media Added" },
  { id: "collection.created", label: "Collection Created" },
  // A rule whose source list moved or whose filter stopped matching keeps
  // "succeeding" forever. This fires on the transition only — the run where a
  // rule that used to match something matches nothing.
  { id: "rule.empty", label: "Rule Matched Nothing" },
  { id: "registry.update_available", label: "Registry Update Available" },
  // Both halves, deliberately. A failed backup is the one people want routed
  // somewhere they will see it; the successful one is how you find out the
  // failure notification would have worked, and it is once a night rather than
  // per item, so it is not the kind of event that trains people to mute a
  // channel.
  { id: "backup.completed", label: "Backup Completed" },
  { id: "backup.failed", label: "Backup Failed" },
  // "The thing you watchlisted is downloading" is the most immediately
  // gratifying message this app can send, and it is per item on purpose — one
  // watchlist add is one deliberate human action, so there is no digest-shaped
  // version of it worth having.
  { id: "watchlist.requested", label: "Watchlist Item Requested" },
  // The failure is separate because it needs a different destination. A
  // request that didn't land is the one thing here somebody has to act on.
  { id: "watchlist.failed", label: "Watchlist Request Failed" },
  // Not an emitted event, unlike everything above it: nothing ever calls
  // `emitEvent("digest.sent")`. It appears here because per-service event
  // selection is already the UI for "route this to that channel", and a
  // digest needs exactly that and nothing more. Ticking it subscribes the
  // service to the periodic digest; the digest job reads the same config keys
  // to decide where to send.
  //
  // It must stay un-emitted. An `emitEvent` call with this id would deliver a
  // plain-text event notification to every service already receiving the
  // composed digest, which is the duplicate this note exists to prevent.
  { id: "digest.sent", label: "Digest" },
] as const;

/**
 * One section of a composed message: a heading and the lines under it.
 *
 * Deliberately not a rich tree. Every destination renders this differently —
 * a Discord embed field, a Slack section block, a table row in an email — and
 * the only structure all of them share is "a heading and some lines". Anything
 * more expressive would render well in one place and badly in the rest.
 */
export interface DigestBlock {
  heading: string;
  lines: string[];
}

/**
 * A message that can be rendered richly where the destination supports it and
 * flatly where it doesn't.
 *
 * `text` is not optional and is not a summary: it is the whole message in
 * plain form. Gotify, Pushover, Pushbullet and LunaSea render only this, so a
 * `text` that says "see attached" is a broken notification on half the
 * services. `blocks` is an enrichment of `text`, never a replacement for it.
 */
export interface RichMessage {
  title: string;
  text: string;
  blocks?: DigestBlock[];
  /** A publicly reachable image. Senders must tolerate its absence. */
  imageUrl?: string;
  /**
   * The structured form, for the generic webhook — which is the one consumer
   * that wants data rather than prose.
   */
  data?: Record<string, unknown>;
}

/** Wrap the plain-string form every event notification uses. */
export function plainMessage(title: string, text: string): RichMessage {
  return { title, text };
}

/** `text` plus its blocks, flattened — the fallback body for plain senders. */
export function flattenMessage(message: RichMessage): string {
  if (!message.blocks || message.blocks.length === 0) return message.text;
  const sections = message.blocks
    .filter((block) => block.lines.length > 0)
    .map((block) => `${block.heading}\n${block.lines.map((line) => `• ${line}`).join("\n")}`);
  return [message.text, ...sections].filter(Boolean).join("\n\n");
}
