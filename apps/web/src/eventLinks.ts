/**
 * Where an event takes you.
 *
 * An event says something happened; the useful next move is nearly always to
 * look at the thing it happened to. Job events carry the run that produced
 * them, so they land on that run's log rather than on the job's history — the
 * run named in the message is the one you wanted, not merely the latest.
 *
 * Returns null for events with nowhere specific to go; the caller renders
 * plain text in that case rather than a link that lands on a page the event
 * doesn't explain.
 */

interface LinkableEvent {
  type: string;
  metadata: Record<string, unknown> | null;
}

function str(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function eventLink(event: LinkableEvent): string | null {
  const meta = event.metadata;

  switch (event.type) {
    case "job.failed":
    case "job.completed": {
      // Events emitted before runs were recorded in metadata have only the
      // job; its history page is the nearest honest answer.
      const runId = str(meta, "runId");
      if (runId) return `/jobs/runs/${encodeURIComponent(runId)}`;
      const jobId = str(meta, "jobId");
      return jobId ? `/jobs/${encodeURIComponent(jobId)}` : null;
    }

    case "health.failed":
    case "health.recovered":
    case "plex.unreachable":
      return "/settings/health";

    case "bandwidth.tested":
      return "/settings/bandwidth";

    case "media.added":
      return "/media";

    // A rule that stopped matching now carries the run that noticed, and that
    // run carries the clause-by-clause funnel explaining why. Landing on the
    // Rules list instead would mean pressing Test and hoping the library still
    // looks the way it did when the run happened.
    case "rule.empty": {
      const ruleId = str(meta, "ruleId");
      const runId = str(meta, "ruleRunId");
      if (ruleId && runId) {
        return `/rules/${encodeURIComponent(ruleId)}/runs?run=${encodeURIComponent(runId)}`;
      }
      const ruleName = str(meta, "ruleName");
      return ruleName ? `/rules?q=${encodeURIComponent(ruleName)}` : "/rules";
    }

    // The Rules table narrows on `?q`, so the rule's name is the deep link.
    case "collection.created": {
      const ruleName = str(meta, "ruleName");
      return ruleName ? `/rules?q=${encodeURIComponent(ruleName)}` : "/rules";
    }

    // Rules, not Registry: the banner that offers to apply the update lives on
    // the Rules page, beside the rule the update is for.
    case "registry.update_available": {
      const ruleName = str(meta, "ruleName");
      return ruleName ? `/rules?q=${encodeURIComponent(ruleName)}` : "/rules";
    }

    // Cleanup's own page is where you keep or release the items it acted on.
    case "cleanup.actioned":
    case "cleanup.pending":
      return "/cleanup";

    case "digest.sent":
      return "/settings/digest";

    case "auth.signin":
    case "auth.denied":
    case "auth.enabled":
    case "auth.disabled":
      return "/settings/security";

    default:
      return null;
  }
}
