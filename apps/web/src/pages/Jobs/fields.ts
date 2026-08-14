/**
 * Per-job declaration of which standard config fields apply,
 * plus its classification in the Jobs UI.
 *
 * Default (omitted entries) is `kind: "feature"` with no Sections,
 * schedule editable, enabled toggleable.
 */
export interface JobFieldsConfig {
  /**
   * UI classification:
   *  - "system" → infrastructure (always installed, locked toggle), shown in System Tasks.
   *  - "feature" → user-opt-in capability, shown in Features section.
   *  - "hidden" → not rendered in the Jobs index (still reachable by direct URL).
   */
  kind?: "system" | "feature" | "hidden";
  /** "hidden" hides the row entirely. Default: editable. */
  schedule?: "editable" | "hidden";
  /** "required" pins the job to always-on (no toggle, row hidden). Default: toggleable. */
  enabled?: "toggleable" | "required" | "hidden";
  /** Show the Plex sections selector. Default: false. */
  sections?: boolean;
}

const fields: Record<string, JobFieldsConfig> = {
  // ── System tasks ─────────────────────────────────────────────────────────
  "sync-media": { kind: "system", enabled: "required", sections: true },
  "sync-collections": { kind: "system", enabled: "required", sections: true },
  "sync-users": { kind: "system", enabled: "required" },
  "sync-recently-added": { kind: "system", enabled: "required" },
  "sync-most-watched": { kind: "system", enabled: "required" },
  "purge-runs": { kind: "system", enabled: "required" },
  "posters-refresh": { kind: "system", enabled: "required", sections: true },
  generate: { kind: "system", enabled: "required", sections: true },
  healthcheck: { kind: "system", enabled: "required" },
  // Manual maintenance: shown so there's a Run button, always-on so it can't
  // be toggled into a state where the button does nothing.
  "collections-sweep": { kind: "system", enabled: "required", sections: true },

  // ── Features (opt-in) ────────────────────────────────────────────────────
  "because-you-watched": { kind: "feature", sections: true },
  shuffle: { kind: "feature" },
  overlays: { kind: "feature", sections: true },

  // ── Hidden from the index (background / one-shot / settings-driven) ──────
  // Apply Sharing Restrictions runs behind the scenes alongside BYW; users
  // shouldn't toggle it. Clear / Remove variants will surface as Settings
  // escape hatches in a later phase. Migrate Collections is driven from Settings.
  label: { kind: "hidden", enabled: "required", sections: true },
  "label-undo": { kind: "hidden", sections: true },
  "byw-remove": { kind: "hidden", enabled: "required", sections: true },
  "overlays-remove": { kind: "hidden", sections: true },
  "migrate-collections": { kind: "hidden" },
  // One-shot actions, not installable capabilities: these are the buttons on
  // Settings → Portal → Personalization, and listing them as features invited
  // people to "enable" a job whose whole job is to be pressed once. Their run
  // status belongs on the page that triggers them.
  "personalize-enable": { kind: "hidden", enabled: "required" },
  "personalize-disable": { kind: "hidden", enabled: "required" },
  // Triggered by the Prerolls page on upload/import; there is nothing to
  // schedule and nothing to toggle.
  "preroll-process": { kind: "hidden", enabled: "required" },
};

const DEFAULTS: JobFieldsConfig = {};

export function getJobFields(jobId: string): Required<JobFieldsConfig> {
  const cfg = fields[jobId] ?? DEFAULTS;
  return {
    kind: cfg.kind ?? "feature",
    schedule: cfg.schedule ?? "editable",
    enabled: cfg.enabled ?? "toggleable",
    sections: cfg.sections ?? false,
  };
}
