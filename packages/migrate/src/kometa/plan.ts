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
};

/** Short note shown for buckets we recognize but don't have a rule type for yet. */
const FUTURE_NOTES: Partial<Record<BucketKind, string>> = {
  decade: "Decades rule type ships in a future Tinkerbell release.",
  year: "Years rule type ships in a future Tinkerbell release.",
  resolution: "Resolutions rule type ships in a future Tinkerbell release.",
  audio_language: "Audio language rule type ships in a future Tinkerbell release.",
  subtitle_language: "Subtitle language rule type ships in a future Tinkerbell release.",
  video_format: "Video format rule type ships in a future Tinkerbell release.",
  streaming: "Streaming rule type ships in a future Tinkerbell release.",
  based_on: "Based-on rule type ships in a future Tinkerbell release.",
  seasonal: "Seasonal rule type ships in a future Tinkerbell release.",
  universe: "Universe rule type ships in a future Tinkerbell release.",
  award: "Awards rule type ships in a future Tinkerbell release.",
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
        ruleConfig: { sections: [group.sectionTitle] },
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
        note: FUTURE_NOTES[group.bucket] ?? "Not yet supported by Tinkerbell.",
      });
    }
  }

  // Sort for stable UI ordering: section, then bucket.
  proposed.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.bucket.localeCompare(b.bucket));
  future.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.bucket.localeCompare(b.bucket));
  unmappable.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.title.localeCompare(b.title));

  return {
    proposed,
    future,
    unmappable,
    totalKometaCollections: classified.length,
  };
}

export { BUCKET_LABEL };
