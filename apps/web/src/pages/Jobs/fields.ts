/**
 * Per-job declaration of which standard config fields apply.
 * Default (omitted entries) is `{}` — no Sections, schedule editable, enabled toggleable.
 */
export interface JobFieldsConfig {
  /** "hidden" hides the row entirely. Default: editable. */
  schedule?: "editable" | "hidden";
  /** "required" pins the job to always-on (no toggle, row hidden). Default: toggleable. */
  enabled?: "toggleable" | "required" | "hidden";
  /** Show the Plex sections selector. Default: false. */
  sections?: boolean;
}

const fields: Record<string, JobFieldsConfig> = {
  "sync-media": { sections: true },
  "sync-collections": { sections: true },
  generate: { sections: true },
  "because-you-watched": { sections: true },
  label: { sections: true },
  "label-undo": { sections: true },
  overlays: { sections: true },
  "overlays-remove": { sections: true },
  "posters-refresh": { sections: true },
  healthcheck: { enabled: "required" },
};

const DEFAULTS: JobFieldsConfig = {};

export function getJobFields(jobId: string): Required<JobFieldsConfig> {
  const cfg = fields[jobId] ?? DEFAULTS;
  return {
    schedule: cfg.schedule ?? "editable",
    enabled: cfg.enabled ?? "toggleable",
    sections: cfg.sections ?? false,
  };
}
