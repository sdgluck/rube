export interface DatabaseServiceConfig {
  service: string;
  title: string;
  serviceName: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyConfigKey: string;
  hint: string;
}

export const DATABASE_SERVICES: Record<string, DatabaseServiceConfig> = {
  omdb: {
    service: "omdb",
    title: "OMDB",
    serviceName: "OMDB",
    apiKeyLabel: "OMDB API Key",
    apiKeyPlaceholder: "Enter OMDB API key",
    apiKeyConfigKey: "global_omdb_api_key",
    hint: "Free tier: 1,000 requests/day. Get a key at omdbapi.com",
  },
  tmdb: {
    service: "tmdb",
    title: "TMDb",
    serviceName: "TMDb",
    apiKeyLabel: "TMDb API Key",
    apiKeyPlaceholder: "Enter TMDb v3 API key",
    apiKeyConfigKey: "global_tmdb_api_key",
    hint: "Used by Popular Actors/Directors and Franchises rules. Get a key at themoviedb.org/settings/api",
  },
  mdblist: {
    service: "mdblist",
    title: "MDBList",
    serviceName: "MDBList",
    apiKeyLabel: "MDBList API Key",
    apiKeyPlaceholder: "Enter MDBList API key",
    apiKeyConfigKey: "global_mdblist_api_key",
    hint: "Get a key at mdblist.com/preferences",
  },
};

export const DATABASE_TAB_ORDER = ["omdb", "tmdb", "mdblist"] as const;
