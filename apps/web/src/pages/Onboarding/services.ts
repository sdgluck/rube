import { ARRS_SERVICES, ARRS_TAB_ORDER } from "#pages/Settings/Arrs/arrs.config";
import { DATABASE_SERVICES, DATABASE_TAB_ORDER } from "#pages/Settings/Databases/databases.config";
import { NOTIFICATION_SERVICES } from "#pages/Settings/Notifications/notifications.config";

export interface ServiceField {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "checkbox";
  placeholder?: string;
  hint?: string;
}

/**
 * How a service's connection is probed. `null` for services with no probe of
 * their own — the notification providers are tested by sending a real message,
 * which needs the credentials saved first, so they carry `"notification"`.
 */
export type ProbeKind = "radarr" | "sonarr" | "seerr" | "tmdb" | "omdb" | "mdblist" | "notification" | null;

export interface OnboardingService {
  id: string;
  title: string;
  /** Matching `HEALTH_SERVICES` entry, which is what colours the card. */
  healthService: string;
  /** One line on why an admin would want this. The catalogues don't carry it. */
  blurb: string;
  fields: ServiceField[];
  probe: ProbeKind;
  /** Set for a service whose settings live inside one config object. */
  objectKey?: string;
  /** Notification providers only — which events the provider is subscribed to. */
  eventsKey?: string;
}

/**
 * What a notification provider gets subscribed to when the user takes the
 * offer on the card.
 *
 * Failures and recoveries only. Subscribing to everything would mean the
 * provider's first message is one of a hundred, and a channel that noisy gets
 * muted inside a week — which leaves the admin worse off than never having
 * set it up.
 */
export const RECOMMENDED_EVENTS = ["job.failed", "health.failed", "health.recovered"];

/**
 * Why this file exists rather than a hand-written list: the URL/key/label of
 * every integration is already declared once, in the three settings
 * catalogues. Retyping them here would mean a placeholder fixed in Settings
 * stays wrong in onboarding. Only `blurb` is new — the settings forms have
 * nowhere to say what a service is *for*, and a card grid does.
 */
const BLURBS: Record<string, string> = {
  radarr: "Rules can send missing films to Radarr to download.",
  sonarr: "The same for TV — rules can request whole series.",
  seerr: "Build collections from what your users have requested.",
  omdb: "Ratings and box office, for rules that sort or filter on them.",
  tmdb: "Powers the Popular Actors, Directors and Franchise rules.",
  mdblist: "Import any MDBList list as a collection.",
  discord: "Post job results and health alerts to a channel.",
  gotify: "Self-hosted push notifications.",
  lunasea: "Push notifications through the LunaSea app.",
  pushbullet: "Push notifications to your devices.",
  pushover: "Push notifications to your phone.",
  slack: "Post job results and health alerts to a channel.",
  telegram: "Send updates to a Telegram chat.",
  webhook: "POST a JSON payload anywhere you like.",
  smtp: "Email — also what the weekly digest sends through.",
};

/** `HEALTH_SERVICES` names its rows differently from the settings catalogues. */
const HEALTH_NAMES: Record<string, string> = {
  radarr: "Radarr",
  sonarr: "Sonarr",
  seerr: "Seerr",
  omdb: "OMDB",
  tmdb: "TMDb",
  mdblist: "MDBList",
  discord: "Discord",
  gotify: "Gotify",
  lunasea: "LunaSea",
  pushbullet: "Pushbullet",
  pushover: "Pushover",
  slack: "Slack",
  telegram: "Telegram",
  webhook: "Webhook",
};

/** Media managers and metadata databases — the `connect` step's grid. */
export const INTEGRATION_SERVICES: OnboardingService[] = [
  ...ARRS_TAB_ORDER.map((id) => {
    const svc = ARRS_SERVICES[id];
    return {
      id,
      title: svc.title,
      healthService: HEALTH_NAMES[id],
      blurb: BLURBS[id],
      probe: id as ProbeKind,
      fields: [
        { key: svc.urlConfigKey, label: svc.urlLabel, placeholder: svc.urlPlaceholder },
        { key: svc.apiKeyConfigKey, label: "API Key", type: "password" as const, placeholder: "Enter API key" },
      ],
    };
  }),
  ...DATABASE_TAB_ORDER.map((id) => {
    const svc = DATABASE_SERVICES[id];
    return {
      id,
      title: svc.title,
      healthService: HEALTH_NAMES[id],
      blurb: BLURBS[id],
      probe: id as ProbeKind,
      fields: [
        {
          key: svc.apiKeyConfigKey,
          label: svc.apiKeyLabel,
          type: "password" as const,
          placeholder: svc.apiKeyPlaceholder,
          hint: svc.hint,
        },
      ],
    };
  }),
];

/** Notification providers — the `notify` step's grid. */
export const NOTIFY_SERVICES: OnboardingService[] = Object.values(NOTIFICATION_SERVICES)
  .map((svc) => ({
    id: svc.service,
    title: svc.title,
    healthService: HEALTH_NAMES[svc.service] ?? svc.title,
    blurb: BLURBS[svc.service] ?? "",
    probe: "notification" as const,
    objectKey: svc.objectKey,
    eventsKey: svc.eventsKey,
    fields: svc.fields,
  }))
  .sort((a, b) => a.title.localeCompare(b.title));

/**
 * A service counts as configured when every one of its fields holds
 * something. Deliberately the same "truthy, and a number counts" test
 * `SettingsNotifications` uses — a port is a number, and reading it as an
 * empty string is what once made every SMTP config look unconfigured.
 */
export function isServiceConfigured(cfg: Record<string, unknown>, service: OnboardingService): boolean {
  const source = service.objectKey ? ((cfg[service.objectKey] as Record<string, unknown>) ?? {}) : cfg;
  return service.fields.every((field) => {
    const value = source[field.key];
    if (typeof value === "number") return value > 0;
    if (typeof value === "boolean") return true;
    return typeof value === "string" && value.length > 0;
  });
}
