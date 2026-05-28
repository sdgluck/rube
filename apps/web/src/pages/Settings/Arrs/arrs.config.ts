export interface ArrsServiceConfig {
  service: string;
  title: string;
  serviceName: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlConfigKey: string;
  apiKeyConfigKey: string;
}

export const ARRS_SERVICES: Record<string, ArrsServiceConfig> = {
  radarr: {
    service: "radarr",
    title: "Radarr",
    serviceName: "Radarr",
    urlLabel: "Radarr URL",
    urlPlaceholder: "http://localhost:7878",
    urlConfigKey: "global_radarr_url",
    apiKeyConfigKey: "global_radarr_api_key",
  },
  sonarr: {
    service: "sonarr",
    title: "Sonarr",
    serviceName: "Sonarr",
    urlLabel: "Sonarr URL",
    urlPlaceholder: "http://localhost:8989",
    urlConfigKey: "global_sonarr_url",
    apiKeyConfigKey: "global_sonarr_api_key",
  },
  seerr: {
    service: "seerr",
    title: "Jellyseerr / Overseerr",
    serviceName: "Seerr",
    urlLabel: "Seerr URL",
    urlPlaceholder: "http://localhost:5055",
    urlConfigKey: "global_seerr_url",
    apiKeyConfigKey: "global_seerr_api_key",
  },
};

export const ARRS_TAB_ORDER = ["radarr", "sonarr", "seerr"] as const;
