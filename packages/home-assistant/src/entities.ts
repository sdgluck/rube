/**
 * What Home Assistant sees, as data: one state document and the entities that
 * read fields out of it.
 *
 * One retained JSON state topic rather than a topic per entity, because the
 * snapshot is taken in one pass and HA's `value_template` is built for exactly
 * this. Fourteen topics would be fourteen publishes per change and fourteen
 * chances for a reader to see half of one snapshot and half of the next.
 *
 * `unique_id` is derived from the topic prefix, not hard-coded, so two
 * Rubes on one broker (a test install beside the real one) are two
 * devices instead of one device whose entities flip between them.
 */

export interface Snapshot {
  version: string;
  streams: number;
  transcodes: number;
  /** Summed session bandwidth Plex reports, in kbit/s. */
  bandwidth: number;
  /** "Nothing", one "user — title", or "N streams". Entities can't carry a list as state. */
  now_playing: string;
  current_job: string;
  busy: boolean;
  rules_failing: number;
  problems: number;
  cleanup_due: number;
  services_down: number;
  movies: number;
  shows: number;
  added_this_week: number;
  /** Lists that don't fit an entity state, exposed as attributes. */
  attrs: {
    sessions: Array<{ user: string; title: string; state: string; decision: string; player: string }>;
    jobs: string[];
    failing_rules: string[];
    services_down: string[];
  };
}

type Component = "sensor" | "binary_sensor";

interface EntityDef {
  id: string;
  component: Component;
  name: string;
  icon: string;
  /** The snapshot field (binary sensors: truthy means ON). */
  field: keyof Omit<Snapshot, "attrs">;
  /** Which `attrs` list rides along as this entity's attributes. */
  attrs?: keyof Snapshot["attrs"];
  unit?: string;
  device_class?: string;
  state_class?: "measurement" | "total";
  entity_category?: "diagnostic";
}

export const ENTITIES: readonly EntityDef[] = [
  {
    id: "streams",
    component: "sensor",
    name: "Streams",
    icon: "mdi:play-network",
    field: "streams",
    attrs: "sessions",
    state_class: "measurement",
  },
  {
    id: "transcodes",
    component: "sensor",
    name: "Transcodes",
    icon: "mdi:cog-transfer",
    field: "transcodes",
    state_class: "measurement",
  },
  {
    id: "bandwidth",
    component: "sensor",
    name: "Stream bandwidth",
    icon: "mdi:speedometer",
    field: "bandwidth",
    unit: "kbit/s",
    device_class: "data_rate",
    state_class: "measurement",
  },
  {
    id: "now_playing",
    component: "sensor",
    name: "Now playing",
    icon: "mdi:movie-play",
    field: "now_playing",
    attrs: "sessions",
  },
  {
    id: "current_job",
    component: "sensor",
    name: "Current job",
    icon: "mdi:progress-clock",
    field: "current_job",
    attrs: "jobs",
  },
  { id: "busy", component: "binary_sensor", name: "Working", icon: "mdi:cogs", field: "busy", device_class: "running" },
  {
    id: "rules_failing",
    component: "sensor",
    name: "Failing rules",
    icon: "mdi:alert-circle-outline",
    field: "rules_failing",
    attrs: "failing_rules",
    state_class: "measurement",
  },
  {
    id: "problems",
    component: "sensor",
    name: "Problems",
    icon: "mdi:alert-outline",
    field: "problems",
    state_class: "measurement",
  },
  {
    id: "cleanup_due",
    component: "sensor",
    name: "Cleanup due soon",
    icon: "mdi:delete-clock",
    field: "cleanup_due",
    state_class: "measurement",
  },
  {
    id: "services_down",
    component: "sensor",
    name: "Services down",
    icon: "mdi:lan-disconnect",
    field: "services_down",
    attrs: "services_down",
    state_class: "measurement",
  },
  {
    id: "service_problem",
    component: "binary_sensor",
    name: "Service problem",
    icon: "mdi:lan-disconnect",
    field: "services_down",
    device_class: "problem",
  },
  {
    id: "movies",
    component: "sensor",
    name: "Movies",
    icon: "mdi:filmstrip",
    field: "movies",
    state_class: "measurement",
  },
  {
    id: "shows",
    component: "sensor",
    name: "Shows",
    icon: "mdi:television-classic",
    field: "shows",
    state_class: "measurement",
  },
  {
    id: "added_this_week",
    component: "sensor",
    name: "Added this week",
    icon: "mdi:new-box",
    field: "added_this_week",
    state_class: "measurement",
  },
  {
    id: "version",
    component: "sensor",
    name: "Version",
    icon: "mdi:tag-outline",
    field: "version",
    entity_category: "diagnostic",
  },
];

export interface Topics {
  /** The node id in discovery topics and the stem of every `unique_id`. */
  node: string;
  state: string;
  availability: string;
  discoveryPrefix: string;
}

export const DEFAULT_TOPIC_PREFIX = "rube";
export const DEFAULT_DISCOVERY_PREFIX = "homeassistant";

export function topicsFor(cfg: { topicPrefix?: string; discoveryPrefix?: string }): Topics {
  const prefix = cfg.topicPrefix?.trim().replace(/\/+$/, "") || DEFAULT_TOPIC_PREFIX;
  return {
    // Discovery node ids allow only [a-zA-Z0-9_-].
    node: prefix.replace(/[^a-zA-Z0-9_-]/g, "_"),
    state: `${prefix}/state`,
    availability: `${prefix}/availability`,
    discoveryPrefix: cfg.discoveryPrefix?.trim().replace(/\/+$/, "") || DEFAULT_DISCOVERY_PREFIX,
  };
}

export function discoveryTopic(topics: Topics, entity: EntityDef): string {
  return `${topics.discoveryPrefix}/${entity.component}/${topics.node}/${entity.id}/config`;
}

export function discoveryPayload(topics: Topics, entity: EntityDef, version: string): Record<string, unknown> {
  const value =
    entity.component === "binary_sensor"
      ? `{{ 'ON' if value_json.${entity.field} else 'OFF' }}`
      : `{{ value_json.${entity.field} }}`;
  return {
    name: entity.name,
    unique_id: `${topics.node}_${entity.id}`,
    object_id: `${topics.node}_${entity.id}`,
    state_topic: topics.state,
    value_template: value,
    availability_topic: topics.availability,
    icon: entity.icon,
    ...(entity.attrs && {
      json_attributes_topic: topics.state,
      // HA wants a mapping, and a bare list is not one.
      json_attributes_template: `{{ {'items': value_json.attrs.${entity.attrs}} | tojson }}`,
    }),
    ...(entity.unit && { unit_of_measurement: entity.unit }),
    ...(entity.device_class && { device_class: entity.device_class }),
    ...(entity.state_class && { state_class: entity.state_class }),
    ...(entity.entity_category && { entity_category: entity.entity_category }),
    device: {
      identifiers: [topics.node],
      name: "Rube",
      manufacturer: "Rube",
      model: "Plex companion",
      sw_version: version,
    },
  };
}
