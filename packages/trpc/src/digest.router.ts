/**
 * The digest admin surface.
 *
 * Read-mostly by design. The digest's *schedule* belongs to its job, its
 * *routing* belongs to the per-service event selection, and its *recipients*
 * belong to the users themselves — so what is left here is looking: preview
 * what would be sent, see who is subscribed, and see what actually went out.
 */
import { z } from "zod";
import { DAY_MS, listDigestSubscribers } from "@tinkerbell/core";
import { periodFor, recentDeliveries, type DigestFrequency } from "@tinkerbell/domain.digest";
import { smtpConfigured } from "@tinkerbell/domain.notifications";
import { previewDigest } from "@tinkerbell/jobs";
import { t, procedure } from "./_base.ts";

const MAX_PREVIEW_DAYS = 365;

export const digestRouter = t.router({
  /**
   * Render a digest without sending it.
   *
   * The period defaults to what a run right now would cover, because "what
   * would go out if this ran" is the question being asked nine times in ten.
   */
  preview: procedure
    .input(
      z.object({
        frequency: z.enum(["weekly", "monthly"]).default("weekly"),
        /** Overrides `frequency`. Epoch ms, half-open. */
        since: z.number().int().optional(),
        until: z.number().int().optional(),
        /** Absent = the server-wide digest. */
        userId: z.number().int().optional(),
        userItemCap: z.number().int().min(1).max(25).optional(),
      }),
    )
    .query(({ input }) => {
      const fallback = periodFor(input.frequency as DigestFrequency);
      const since = input.since ?? fallback.since;
      const until = input.until ?? fallback.until;

      if (until <= since) throw new Error("The end of the period must be after its start.");
      if (until - since > MAX_PREVIEW_DAYS * DAY_MS) {
        throw new Error(`A digest period can't be longer than ${MAX_PREVIEW_DAYS} days.`);
      }

      return previewDigest({ since, until, userId: input.userId, userItemCap: input.userItemCap });
    }),

  /**
   * Who has asked for a digest.
   *
   * Email addresses are shown: the admin is the person who has to answer "why
   * hasn't it arrived", and they can't check a typo they can't see. It is the
   * same account that can already read every Plex token in Settings.
   */
  subscribers: procedure.query(() =>
    listDigestSubscribers().map((s) => ({
      userId: s.userId,
      username: s.username,
      email: s.email,
      frequency: s.frequency,
    })),
  ),

  /** Recent deliveries, whatever their outcome. */
  deliveries: procedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => recentDeliveries(input?.limit ?? 50)),

  /** Whether email can be sent at all — the preview page leads with this. */
  emailStatus: procedure.query(() => ({ smtpConfigured: smtpConfigured() })),
});
