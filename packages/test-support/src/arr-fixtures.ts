/**
 * The quality vocabulary of Radarr v5 and Sonarr v4, as their schema
 * endpoints describe it.
 *
 * Transcribed from each app's `Quality.cs` and its default-profile ordering
 * rather than captured byte-for-byte. What matters here is the parts the
 * preset planner depends on and a test can therefore pin down: the quality
 * names (which differ between the apps), their ids, the default group
 * structure the planner has to flatten, and the set of custom format
 * specification implementations each app supports. Display-only fields
 * (labels, help text, `infoLink`) are trimmed.
 *
 * If a preset references a quality or a specification that is not here, the
 * contracts test fails. That is the point: a name typo would otherwise
 * surface as a 400 from somebody's Radarr.
 */

type Service = "radarr" | "sonarr";

interface FixtureQuality {
  id: number;
  name: string;
  source: string;
  resolution: number;
}

/** Lowest preference first, exactly as `/qualityprofile/schema` orders `items`. */
type Layout = Array<string | { id: number; name: string; qualities: string[] }>;

const RADARR_QUALITIES: FixtureQuality[] = [
  { id: 0, name: "Unknown", source: "unknown", resolution: 0 },
  { id: 24, name: "WORKPRINT", source: "workprint", resolution: 0 },
  { id: 25, name: "CAM", source: "cam", resolution: 0 },
  { id: 26, name: "TELESYNC", source: "telesync", resolution: 0 },
  { id: 27, name: "TELECINE", source: "telecine", resolution: 0 },
  { id: 29, name: "REGIONAL", source: "dvd", resolution: 480 },
  { id: 28, name: "DVDSCR", source: "dvd", resolution: 480 },
  { id: 1, name: "SDTV", source: "tv", resolution: 480 },
  { id: 2, name: "DVD", source: "dvd", resolution: 0 },
  { id: 23, name: "DVD-R", source: "dvd", resolution: 480 },
  { id: 8, name: "WEBDL-480p", source: "webdl", resolution: 480 },
  { id: 12, name: "WEBRip-480p", source: "webrip", resolution: 480 },
  { id: 20, name: "Bluray-480p", source: "bluray", resolution: 480 },
  { id: 21, name: "Bluray-576p", source: "bluray", resolution: 576 },
  { id: 4, name: "HDTV-720p", source: "tv", resolution: 720 },
  { id: 5, name: "WEBDL-720p", source: "webdl", resolution: 720 },
  { id: 14, name: "WEBRip-720p", source: "webrip", resolution: 720 },
  { id: 6, name: "Bluray-720p", source: "bluray", resolution: 720 },
  { id: 9, name: "HDTV-1080p", source: "tv", resolution: 1080 },
  { id: 3, name: "WEBDL-1080p", source: "webdl", resolution: 1080 },
  { id: 15, name: "WEBRip-1080p", source: "webrip", resolution: 1080 },
  { id: 7, name: "Bluray-1080p", source: "bluray", resolution: 1080 },
  { id: 30, name: "Remux-1080p", source: "bluray", resolution: 1080 },
  { id: 16, name: "HDTV-2160p", source: "tv", resolution: 2160 },
  { id: 18, name: "WEBDL-2160p", source: "webdl", resolution: 2160 },
  { id: 17, name: "WEBRip-2160p", source: "webrip", resolution: 2160 },
  { id: 19, name: "Bluray-2160p", source: "bluray", resolution: 2160 },
  { id: 31, name: "Remux-2160p", source: "bluray", resolution: 2160 },
  { id: 22, name: "BR-DISK", source: "bluray", resolution: 1080 },
  { id: 10, name: "Raw-HD", source: "tv", resolution: 1080 },
];

const RADARR_LAYOUT: Layout = [
  "Unknown",
  "WORKPRINT",
  "CAM",
  "TELESYNC",
  "TELECINE",
  "REGIONAL",
  "DVDSCR",
  "SDTV",
  "DVD",
  "DVD-R",
  { id: 1000, name: "WEB 480p", qualities: ["WEBDL-480p", "WEBRip-480p"] },
  "Bluray-480p",
  "Bluray-576p",
  "HDTV-720p",
  { id: 1001, name: "WEB 720p", qualities: ["WEBDL-720p", "WEBRip-720p"] },
  "Bluray-720p",
  "HDTV-1080p",
  { id: 1002, name: "WEB 1080p", qualities: ["WEBDL-1080p", "WEBRip-1080p"] },
  "Bluray-1080p",
  "Remux-1080p",
  "HDTV-2160p",
  { id: 1003, name: "WEB 2160p", qualities: ["WEBDL-2160p", "WEBRip-2160p"] },
  "Bluray-2160p",
  "Remux-2160p",
  "BR-DISK",
  "Raw-HD",
];

const SONARR_QUALITIES: FixtureQuality[] = [
  { id: 0, name: "Unknown", source: "unknown", resolution: 0 },
  { id: 1, name: "SDTV", source: "television", resolution: 480 },
  { id: 8, name: "WEBDL-480p", source: "web", resolution: 480 },
  { id: 12, name: "WEBRip-480p", source: "webRip", resolution: 480 },
  { id: 2, name: "DVD", source: "dvd", resolution: 480 },
  { id: 13, name: "Bluray-480p", source: "bluray", resolution: 480 },
  { id: 22, name: "Bluray-576p", source: "bluray", resolution: 576 },
  { id: 4, name: "HDTV-720p", source: "television", resolution: 720 },
  { id: 9, name: "HDTV-1080p", source: "television", resolution: 1080 },
  { id: 10, name: "Raw-HD", source: "televisionRaw", resolution: 1080 },
  { id: 5, name: "WEBDL-720p", source: "web", resolution: 720 },
  { id: 14, name: "WEBRip-720p", source: "webRip", resolution: 720 },
  { id: 6, name: "Bluray-720p", source: "bluray", resolution: 720 },
  { id: 3, name: "WEBDL-1080p", source: "web", resolution: 1080 },
  { id: 15, name: "WEBRip-1080p", source: "webRip", resolution: 1080 },
  { id: 7, name: "Bluray-1080p", source: "bluray", resolution: 1080 },
  { id: 20, name: "Bluray-1080p Remux", source: "blurayRaw", resolution: 1080 },
  { id: 16, name: "HDTV-2160p", source: "television", resolution: 2160 },
  { id: 18, name: "WEBDL-2160p", source: "web", resolution: 2160 },
  { id: 17, name: "WEBRip-2160p", source: "webRip", resolution: 2160 },
  { id: 19, name: "Bluray-2160p", source: "bluray", resolution: 2160 },
  { id: 21, name: "Bluray-2160p Remux", source: "blurayRaw", resolution: 2160 },
];

const SONARR_LAYOUT: Layout = [
  "Unknown",
  "SDTV",
  { id: 1000, name: "WEB 480p", qualities: ["WEBDL-480p", "WEBRip-480p"] },
  "DVD",
  "Bluray-480p",
  "Bluray-576p",
  "HDTV-720p",
  "HDTV-1080p",
  "Raw-HD",
  { id: 1001, name: "WEB 720p", qualities: ["WEBDL-720p", "WEBRip-720p"] },
  "Bluray-720p",
  { id: 1002, name: "WEB 1080p", qualities: ["WEBDL-1080p", "WEBRip-1080p"] },
  "Bluray-1080p",
  "Bluray-1080p Remux",
  "HDTV-2160p",
  { id: 1003, name: "WEB 2160p", qualities: ["WEBDL-2160p", "WEBRip-2160p"] },
  "Bluray-2160p",
  "Bluray-2160p Remux",
];

function qualityTable(service: Service) {
  return new Map((service === "radarr" ? RADARR_QUALITIES : SONARR_QUALITIES).map((q) => [q.name, q]));
}

/** `GET /qualityprofile/schema`: every quality disallowed, in default order. */
export function qualityProfileSchemaFixture(service: Service): Record<string, unknown> {
  const table = qualityTable(service);
  const layout = service === "radarr" ? RADARR_LAYOUT : SONARR_LAYOUT;
  const single = (name: string) => ({ quality: table.get(name), items: [], allowed: false });
  return {
    name: "",
    upgradeAllowed: false,
    cutoff: 0,
    items: layout.map((entry) =>
      typeof entry === "string"
        ? single(entry)
        : { id: entry.id, name: entry.name, items: entry.qualities.map(single), allowed: false },
    ),
    minFormatScore: 0,
    cutoffFormatScore: 0,
    minUpgradeFormatScore: 1,
    formatItems: [],
    ...(service === "radarr" ? { language: { id: 1, name: "English" } } : {}),
  };
}

/** `GET /qualitydefinition`: one row per quality, ids 1.. in weight order. */
export function qualityDefinitionsFixture(service: Service): Array<Record<string, unknown>> {
  const qualities = service === "radarr" ? RADARR_QUALITIES : SONARR_QUALITIES;
  return qualities.map((q, i) => ({
    id: i + 1,
    quality: q,
    title: q.name,
    weight: i + 1,
    minSize: 0,
    maxSize: null,
    preferredSize: null,
  }));
}

function valueField(type: string) {
  return [{ order: 0, name: "value", label: "Value", value: type === "number" ? 0 : "", type, advanced: false }];
}

const SPEC_FIELDS: Record<string, Array<Record<string, unknown>>> = {
  ReleaseTitleSpecification: valueField("textbox"),
  ReleaseGroupSpecification: valueField("textbox"),
  EditionSpecification: valueField("textbox"),
  LanguageSpecification: valueField("select"),
  IndexerFlagSpecification: valueField("select"),
  SourceSpecification: valueField("select"),
  ResolutionSpecification: valueField("select"),
  QualityModifierSpecification: valueField("select"),
  ReleaseTypeSpecification: valueField("select"),
  SizeSpecification: [
    { order: 0, name: "min", label: "Minimum Size", unit: "GB", value: 0, type: "number" },
    { order: 1, name: "max", label: "Maximum Size", unit: "GB", value: 0, type: "number" },
  ],
  YearSpecification: [
    { order: 0, name: "min", label: "Minimum Year", value: 0, type: "number" },
    { order: 1, name: "max", label: "Maximum Year", value: 0, type: "number" },
  ],
};

const SPEC_IMPLEMENTATIONS: Record<Service, string[]> = {
  radarr: [
    "ReleaseTitleSpecification",
    "EditionSpecification",
    "LanguageSpecification",
    "IndexerFlagSpecification",
    "SourceSpecification",
    "ResolutionSpecification",
    "ReleaseGroupSpecification",
    "QualityModifierSpecification",
    "SizeSpecification",
    "YearSpecification",
  ],
  sonarr: [
    "ReleaseTitleSpecification",
    "LanguageSpecification",
    "IndexerFlagSpecification",
    "SourceSpecification",
    "ResolutionSpecification",
    "ReleaseGroupSpecification",
    "ReleaseTypeSpecification",
    "SizeSpecification",
  ],
};

/**
 * `GET /customformat/schema`: one template per specification implementation.
 *
 * `withoutSize` models an install that predates `SizeSpecification`, which is
 * the case the planner has to degrade gracefully on.
 */
export function customFormatSchemaFixture(
  service: Service,
  opts: { withoutSize?: boolean } = {},
): Array<Record<string, unknown>> {
  return SPEC_IMPLEMENTATIONS[service]
    .filter((impl) => !(opts.withoutSize && impl === "SizeSpecification"))
    .map((implementation) => ({
      implementation,
      implementationName: implementation.replace(/Specification$/, ""),
      negate: false,
      required: false,
      fields: SPEC_FIELDS[implementation],
    }));
}
