/**
 * Collection labels Tinkerbell writes itself, lower-cased. The UI renders them
 * as provenance rather than as tags a person added.
 *
 * One list rather than four copies in the web app. Adding a job label used to
 * mean finding each copy, and a missed one showed that job's rows with the
 * label styled as an ordinary user tag.
 */
export const SYSTEM_COLLECTION_LABELS: readonly string[] = [
  "tinkerbell",
  "generated",
  "becauseyouwatched",
  "wethinkyoudlike",
];
