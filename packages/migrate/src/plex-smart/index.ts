import type { CollectionInput, MigrationPlan, PlanItem, UnmappableEntry } from "../types.ts";
import { parseSmartFilterUri } from "./parse.ts";

/**
 * `CollectionInput` shape from the migrate package doesn't carry the
 * Plex `smart` flag or the filter URI — those live on the server-side
 * `collections` table. The Plex Smart provider needs both, so it takes
 * its own augmented shape here. The runtime adapter in
 * `domains/migration` populates these fields when loading.
 */
export interface SmartCollectionInput extends CollectionInput {
  smart: boolean;
  smartFilter: string;
}

export function detectSmartCollections(collections: SmartCollectionInput[]): SmartCollectionInput[] {
  return collections.filter((c) => c.smart && c.smartFilter.length > 0);
}

/**
 * One PlanItem per smart collection — no bucket-grouping, since each
 * smart collection encodes a unique user-defined filter that has to
 * round-trip individually. Each item carries the `smart_filter` bucket
 * kind so downstream code can recognise these as filter-style imports
 * rather than category-grouped ones.
 */
export function buildPlexSmartPlan(collections: SmartCollectionInput[]): MigrationPlan {
  const proposed: PlanItem[] = [];
  const unmappable: UnmappableEntry[] = [];

  for (const c of collections) {
    const { filters, unsupported } = parseSmartFilterUri(c.smartFilter);

    if (filters.length === 0 || unsupported.length > 0) {
      unmappable.push({
        ratingKey: c.ratingKey,
        title: c.title,
        sectionId: c.sectionId,
        sectionTitle: c.sectionTitle,
        reason:
          filters.length === 0
            ? "smart filter has no translatable clauses"
            : `unsupported clauses: ${unsupported.join(", ")}`,
      });
      continue;
    }

    proposed.push({
      key: `plex-smart::${c.ratingKey}`,
      bucket: "smart_filter" as const,
      ruleType: "smart_filter",
      ruleName: c.title,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      ruleConfig: {
        filters,
        // Restrict the generated rule to the section the original smart
        // collection lived in — Plex smart filters are section-scoped.
        sections: [c.sectionTitle],
        collectionName: c.title,
      },
      sampleNames: [c.title],
      replacesCount: 1,
      replacesRatingKeys: [c.ratingKey],
    });
  }

  proposed.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.ruleName.localeCompare(b.ruleName));
  unmappable.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.title.localeCompare(b.title));

  return {
    proposed,
    future: [],
    unmappable,
    totalSourceItems: collections.length,
  };
}

export { parseSmartFilterUri } from "./parse.ts";
export type { ParsedClause, ParseResult } from "./parse.ts";
