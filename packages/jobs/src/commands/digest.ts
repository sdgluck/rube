import { DIGEST_DEFAULTS } from "@rube/contracts";
import { perDeps } from "@rube/container";
import { ServicesToken, type Services } from "@rube/composition";
/**
 * The digest run: build, then deliver, then record.
 *
 * Two audiences, two shapes. The **server-wide** digest goes to whichever
 * notification services the admin subscribed to the digest — the same
 * per-service event selection every other notification uses. The **per-user**
 * digests go by email, only to people who typed an address into the portal and
 * chose a frequency, and are tailored to what each of them said they like.
 *
 * Everything routes through the delivery ledger first. One failed recipient
 * must not cost the rest their digest, and a retried job must not re-send to
 * the people it already reached — those are the two failures that make an
 * automated newsletter worse than no newsletter.
 */
import { eq } from "drizzle-orm";
import { plexUsers } from "@rube/db";
import { errorMessage, type DigestJobConfig, type JobContext } from "@rube/core";
import { isDigestEmpty, renderDigest, SERVER_WIDE_USER_ID, type DeliveryKey, type Digest } from "@rube/domain.digest";
import { SmtpNotConfiguredError, type RichMessage } from "@rube/domain.notifications";

/**
 * The event id services subscribe to in order to receive the digest. Never
 * emitted — see the note beside it in the notifications event table.
 */
const DIGEST_EVENT = "digest.sent";

const DEFAULT_MIN_ADDED_ITEMS = DIGEST_DEFAULTS.minAddedItems;

type SendOutcome = "sent" | "skipped" | "failed";

// ─── Delivery ────────────────────────────────────────────────────────────────

interface DeliveryPlan {
  key: DeliveryKey;
  empty: boolean;
  digest: Digest;
  label: string;
  send: () => Promise<void>;
}

export const createDigestCommand = perDeps(function createDigestCommand(
  deps: Pick<Services, "config" | "db" | "digest" | "notifications" | "preferences">,
) {
  const { config, db, digest, notifications, preferences } = deps;
  const { getConfig } = config;
  const { getUserPreferences, listDigestSubscribers } = preferences;
  const { buildDigest, claimDelivery, completeDelivery, lastSentAt, periodFor, releaseDelivery } = digest;
  const { sendRichNotification, sendSmtp, servicesForEvent, smtpConfigured } = notifications;

  async function run(ctx: JobContext, config: DigestJobConfig): Promise<void> {
    const now = Date.now();
    const minAddedItems = config.minAddedItems ?? DEFAULT_MIN_ADDED_ITEMS;
    const serverName = getConfig("portal_branding")?.title || undefined;

    ctx.log("rube digest");

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    const tally = (outcome: SendOutcome) => {
      if (outcome === "sent") sent++;
      else if (outcome === "failed") failed++;
      else skipped++;
    };

    if (config.includeServerDigest ?? DIGEST_DEFAULTS.includeServerDigest) {
      ctx.progress(1, 3, "Building the server digest…");
      for (const outcome of await sendServerDigest(ctx, config, minAddedItems, serverName, now)) tally(outcome);
    }

    if (config.includeUserDigests ?? DIGEST_DEFAULTS.includeUserDigests) {
      ctx.progress(2, 3, "Building per-user digests…");
      for (const outcome of await sendUserDigests(ctx, config, minAddedItems, serverName, now)) tally(outcome);
    }

    ctx.progress(3, 3, "Done");
    ctx.log(`Done — ${sent} sent, ${skipped} skipped, ${failed} failed.`);

    // A run where every single delivery failed is a failed run: the channel is
    // misconfigured and nobody got anything. A run with some failures is not —
    // one dead webhook shouldn't turn a successful newsletter red.
    if (sent === 0 && failed > 0) {
      throw new Error(`Every digest delivery failed (${failed}). Check the notification settings for those channels.`);
    }
  }

  // ─── Server-wide ─────────────────────────────────────────────────────────────

  async function sendServerDigest(
    ctx: JobContext,
    config: DigestJobConfig,
    minAddedItems: number,
    serverName: string | undefined,
    now: number,
  ): Promise<SendOutcome[]> {
    const services = servicesForEvent(DIGEST_EVENT);
    if (services.length === 0) {
      ctx.log("No service is subscribed to the digest — nothing to send server-wide.");
      return [];
    }

    const period = periodFor(config.frequency ?? DIGEST_DEFAULTS.frequency, now);
    const digest = buildDigest({ since: period.since, until: period.until });
    const message = renderDigest(digest, { serverName });
    const empty = isDigestEmpty(digest, minAddedItems);

    const outcomes: SendOutcome[] = [];
    for (const service of services) {
      if (ctx.signal.aborted) break;
      outcomes.push(
        await deliver(ctx, {
          key: {
            periodStart: period.since,
            periodEnd: period.until,
            userId: SERVER_WIDE_USER_ID,
            channel: service,
          },
          empty,
          digest,
          label: `server digest via ${service}`,
          send: () => sendRichNotification(service, message),
        }),
      );
    }
    return outcomes;
  }

  // ─── Per user ────────────────────────────────────────────────────────────────

  async function sendUserDigests(
    ctx: JobContext,
    config: DigestJobConfig,
    minAddedItems: number,
    serverName: string | undefined,
    now: number,
  ): Promise<SendOutcome[]> {
    const subscribers = listDigestSubscribers();
    if (subscribers.length === 0) {
      ctx.log("No portal user has subscribed to a digest.");
      return [];
    }

    if (!smtpConfigured()) {
      // Not a failure. An install with no mail server hasn't failed to send the
      // digest, it has no way to send it — and saying so is more useful than a
      // stack of identical connection errors.
      ctx.log(`${subscribers.length} user(s) have subscribed, but SMTP isn't configured — skipping per-user digests.`);
      return [];
    }

    const outcomes: SendOutcome[] = [];
    for (const subscriber of subscribers) {
      if (ctx.signal.aborted) break;

      const period = periodFor(subscriber.frequency, now);
      // The rate limit, and the reason a weekly job doesn't mail a monthly
      // subscriber four times a month: a digest already sent inside this
      // subscriber's current window means their next one isn't due yet.
      if (lastSentAt(subscriber.userId, period.since) != null) {
        ctx.log(`${subscriber.username}: already had a digest this ${subscriber.frequency} period.`);
        outcomes.push("skipped");
        continue;
      }

      const digest = buildDigest({
        since: period.since,
        until: period.until,
        userId: subscriber.userId,
        preferences: subscriber.preferences,
        userItemCap: config.userItemCap,
      });
      const message = renderDigest(digest, { username: subscriber.username, serverName });

      outcomes.push(
        await deliver(ctx, {
          key: {
            periodStart: period.since,
            periodEnd: period.until,
            userId: subscriber.userId,
            channel: "email",
          },
          empty: isDigestEmpty(digest, minAddedItems),
          digest,
          label: `digest for ${subscriber.username}`,
          send: () => sendSmtp(message, { to: subscriber.email }),
        }),
      );
    }
    return outcomes;
  }

  /**
   * Claim, send, record. The claim comes first so a crash mid-send can only ever
   * lose a digest, never duplicate one.
   */
  async function deliver(ctx: JobContext, plan: DeliveryPlan): Promise<SendOutcome> {
    const { key } = plan;

    if (!claimDelivery(key)) {
      ctx.log(`${plan.label}: already delivered for this period.`);
      return "skipped";
    }

    if (plan.empty) {
      completeDelivery(key, { status: "skipped_empty", itemCount: 0 });
      ctx.log(`${plan.label}: nothing worth sending this period.`);
      return "skipped";
    }

    try {
      await plan.send();
      completeDelivery(key, { status: "sent", itemCount: plan.digest.added.length });
      ctx.log(`${plan.label}: sent (${plan.digest.added.length} item(s)).`);
      return "sent";
    } catch (err) {
      const message = errorMessage(err);
      if (err instanceof SmtpNotConfiguredError) {
        // Nothing was attempted, so nothing is owed a retry-blocking row.
        releaseDelivery(key);
        ctx.log(`${plan.label}: skipped — ${message}`);
        return "skipped";
      }
      // The row stays, carrying the error. Keeping it means a broken channel is
      // visible in Settings and isn't retried every hour for the rest of the
      // period; the next period claims a fresh row and tries again.
      completeDelivery(key, { status: "failed", error: message, itemCount: plan.digest.added.length });
      ctx.log(`${plan.label}: FAILED — ${message}`);
      return "failed";
    }
  }

  /**
   * Build and render without sending — what the Settings preview calls.
   *
   * Works for any portal user, not only current subscribers: the point of a
   * preview is to see what someone *would* get before asking them to sign up.
   * Nobody should first see their newsletter in a friend's inbox.
   */
  function previewDigest(opts: { since: number; until: number; userId?: number; userItemCap?: number }): {
    digest: Digest;
    message: RichMessage;
  } {
    const serverName = getConfig("portal_branding")?.title || undefined;

    if (opts.userId == null) {
      const digest = buildDigest({ since: opts.since, until: opts.until });
      return { digest, message: renderDigest(digest, { serverName }) };
    }

    const { preferences } = getUserPreferences(opts.userId);
    const username = getPlexUsername(opts.userId);
    const digest = buildDigest({
      since: opts.since,
      until: opts.until,
      userId: opts.userId,
      preferences,
      userItemCap: opts.userItemCap,
    });
    return { digest, message: renderDigest(digest, { username, serverName }) };
  }

  function getPlexUsername(userId: number): string | undefined {
    return db.select({ username: plexUsers.username }).from(plexUsers).where(eq(plexUsers.userId, userId)).get()
      ?.username;
  }

  return { run, previewDigest };
});

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createDigestCommand>["run"]>[1],
): Promise<void> {
  return createDigestCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
