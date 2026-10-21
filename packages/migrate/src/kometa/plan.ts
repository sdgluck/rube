import type {
  BucketKind,
  ClassifiedCollection,
  FuturePlanItem,
  MigrationPlan,
  PlanItem,
  PlanOptions,
  UnmappableEntry,
} from "../types.ts";

/**
 * Per-bucket display label. Drives both the rule name ("Studios — Films")
 * and the "no rule type yet" copy in the future-items list.
 */
const BUCKET_LABEL: Record<BucketKind, string> = {
  studio: "Studios",
  network: "Networks",
  genre: "Genres",
  country: "Countries",
  actor: "Actors",
  director: "Directors",
  content_rating: "Content Ratings",
  franchise: "Franchises",
  decade: "Decades",
  year: "Years",
  resolution: "Resolutions",
  audio_language: "Audio Languages",
  subtitle_language: "Subtitle Languages",
  video_format: "Video Formats",
  streaming: "Streaming",
  based_on: "Based On",
  seasonal: "Seasonal",
  universe: "Universes",
  award: "Awards",
  list: "External Lists",
  smart_filter: "Smart Filters",
};

/** Short note shown for buckets we recognize but don't have a rule type for yet. */
const FUTURE_NOTES: Partial<Record<BucketKind, string>> = {
  decade: "Decades rule type ships in a future Rube release.",
  year: "Years rule type ships in a future Rube release.",
  resolution: "Resolutions rule type ships in a future Rube release.",
  audio_language: "Audio language rule type ships in a future Rube release.",
  subtitle_language: "Subtitle language rule type ships in a future Rube release.",
  video_format: "Video format rule type ships in a future Rube release.",
  streaming: "Streaming rule type ships in a future Rube release.",
  based_on: "Based-on rule type ships in a future Rube release.",
  seasonal: "Seasonal rule type ships in a future Rube release.",
  universe: "Universe rule type ships in a future Rube release.",
  award: "Awards rule type ships in a future Rube release.",
};

interface Group {
  bucket: BucketKind;
  sectionId: string;
  sectionTitle: string;
  members: ClassifiedCollection[];
}

function groupKey(c: ClassifiedCollection): string {
  return `${c.bucket}::${c.collection.sectionId}`;
}

/**
 * Build the migration plan. One PlanItem per (bucket, section) — see
 * decision log: "one rule per bucket per section". Items the server's
 * supportedRuleTypes map can't satisfy fall through to `future`.
 */
export function buildPlan(classified: ClassifiedCollection[], opts: PlanOptions): MigrationPlan {
  const groups = new Map<string, Group>();
  const unmappable: UnmappableEntry[] = [];

  for (const entry of classified) {
    if (entry.bucket == null) {
      unmappable.push({
        ratingKey: entry.collection.ratingKey,
        title: entry.collection.title,
        sectionId: entry.collection.sectionId,
        sectionTitle: entry.collection.sectionTitle,
        reason: entry.reason ?? "unclassified",
      });
      continue;
    }

    const key = groupKey(entry as ClassifiedCollection & { bucket: BucketKind });
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(entry);
    } else {
      groups.set(key, {
        bucket: entry.bucket,
        sectionId: entry.collection.sectionId,
        sectionTitle: entry.collection.sectionTitle,
        members: [entry],
      });
    }
  }

  const proposed: PlanItem[] = [];
  const future: FuturePlanItem[] = [];

  for (const group of groups.values()) {
    const sampleNames = group.members.slice(0, 5).map((m) => m.collection.title);
    const ruleType = opts.supportedRuleTypes[group.bucket];
    const baseName = `${BUCKET_LABEL[group.bucket]} — ${group.sectionTitle}`;

    if (ruleType) {
      proposed.push({
        key: `${group.bucket}::${group.sectionId}`,
        bucket: group.bucket,
        ruleType,
        ruleName: baseName,
        sectionId: group.sectionId,
        sectionTitle: group.sectionTitle,
        ruleConfig: { sections: [group.sectionTitle], pinToHomepage: false },
        // Title-scan is never better than `partial` and saying otherwise would
        // be a lie the review screen repeats a hundred times: we inferred a
        // category from a collection's *name*, so the source's filters, limit
        // and ordering are not lost — they were never visible in the first
        // place. The YAML path is where `exact` is earned.
        confidence: "partial",
        warnings: [
          {
            code: "title-scan-inferred",
            message:
              "Inferred from the collection name — Kometa's own filters, limit, sort and schedule for these collections weren't visible. Import your Kometa config for a faithful migration.",
          },
        ],
        origin: { kind: "title-scan" },
        sampleNames,
        replacesCount: group.members.length,
        replacesRatingKeys: group.members.map((m) => m.collection.ratingKey),
      });
    } else {
      future.push({
        bucket: group.bucket,
        sectionId: group.sectionId,
        sectionTitle: group.sectionTitle,
        sampleNames,
        count: group.members.length,
        note: FUTURE_NOTES[group.bucket] ?? "Not yet supported by Rube.",
      });
    }
  }

  // Sort for stable UI ordering: section, then bucket. Every item this
  // function produces has a bucket — it groups by one — but `PlanItem.bucket`
  // is optional for the YAML provider's sake, so fall back rather than assert.
  proposed.sort(
    (a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || (a.bucket ?? "").localeCompare(b.bucket ?? ""),
  );
  future.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.bucket.localeCompare(b.bucket));
  unmappable.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.title.localeCompare(b.title));

  return {
    proposed,
    future,
    unmappable,
    // Title-scan reads already-synced rows; there is no source to fail to
    // parse, so there is nothing to report here.
    diagnostics: [],
    totalSourceItems: classified.length,
  };
}

export { BUCKET_LABEL };
