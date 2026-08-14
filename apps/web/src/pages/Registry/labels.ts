export const REQUIREMENT_LABELS: Record<string, string> = {
  omdb: "OMDb",
  seerr: "Overseerr",
  tmdb: "TMDb",
  llm: "an AI provider",
  mdblist: "MDBList",
};

/** Where to go to fix a missing requirement. Shown in the import preview so
 *  "needs TMDb" is actionable rather than just discouraging. */
export const REQUIREMENT_SETTINGS: Record<string, string> = {
  omdb: "/settings/databases/omdb",
  tmdb: "/settings/databases/tmdb",
  mdblist: "/settings/databases/mdblist",
  // Overseerr lives under Arrs, not Databases — it's a request service.
  seerr: "/settings/arrs/seerr",
  llm: "/settings/ai",
};
