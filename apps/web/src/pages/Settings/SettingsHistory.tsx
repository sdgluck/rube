import { useState } from "react";
import { CHANGE_LOG_ENTITIES, type ChangeLogEntity } from "@rube/contracts";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import RelativeTime from "#components/RelativeTime";
import ErrorState from "#components/ErrorState";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import local from "./SettingsHistory.module.css";

type Entity = ChangeLogEntity;

const ENTITY_LABELS: Record<Entity, string> = {
  rule: "Rules",
  config: "Settings",
  job: "Jobs",
  overlay_preset: "Overlay presets",
  preroll: "Prerolls",
  // A whole-page save from Jobs → Schedule: several jobs and the window at once.
  schedule: "Schedule changes",
  arr_quality_profile: "Quality profiles",
  problem_dismissal: "Dismissed problems",
};

/** Who did it, in words rather than the raw source token. */
function actorLabel(source: string, username: string): string {
  if (username) return username;
  if (source === "system") return "Rube itself";
  if (source.startsWith("job:")) return `the ${source.slice(4)} job`;
  if (source === "import") return "an import";
  if (source === "restore") return "a restore";
  return source;
}

function summarise(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? "(none)" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "(changed)";
}

/**
 * Every change anybody made to Rube's own configuration.
 *
 * The counterpart to `/changes`, which is what Rube did to *Plex*. The
 * two are kept apart deliberately: they answer different questions and are
 * read at different moments — that page after a collection looks wrong, this
 * one after the app itself starts behaving differently.
 */
export default function SettingsHistory() {
  const [entity, setEntity] = useState<Entity | "">("");

  const historyQuery = trpc.history.list.useQuery(
    { entity: entity || undefined, limit: 200 },
    { refetchOnWindowFocus: false },
  );
  const entries = historyQuery.data?.entries ?? [];

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Change history" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="What changed">
        <p className={settings.hint}>
          Every edit to a rule, a setting, a job schedule, an overlay preset or a preroll — who made it and what it was
          before. Secrets are recorded as redacted, so this is never a history of your API keys. Kept for 180 days.
        </p>

        <div className={local.filters}>
          <button
            type="button"
            className={entity === "" ? local.filterActive : local.filter}
            onClick={() => setEntity("")}
          >
            Everything
          </button>
          {CHANGE_LOG_ENTITIES.map((e) => (
            <button
              key={e}
              type="button"
              className={entity === e ? local.filterActive : local.filter}
              onClick={() => setEntity(e)}
            >
              {ENTITY_LABELS[e]}
            </button>
          ))}
        </div>

        {historyQuery.error && (
          <ErrorState
            inline
            title="Couldn't load the change history"
            error={historyQuery.error}
            onRetry={() => historyQuery.refetch()}
          />
        )}

        {!historyQuery.isLoading && entries.length === 0 && (
          <p className={settings.hint}>Nothing recorded yet — changes are logged from now on.</p>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className={local.entry}>
            <div className={local.head}>
              <span className={local.action} data-action={entry.action}>
                {entry.action}
              </span>
              <span className={local.entity}>{ENTITY_LABELS[entry.entity as Entity] ?? entry.entity}</span>
              <span className={local.subject}>{entry.entityId}</span>
              <RelativeTime timestamp={entry.timestamp} />
              <span className={local.actor}>by {actorLabel(entry.source, entry.username)}</span>
            </div>
            {entry.fields.length > 0 && (
              <ul className={local.fields}>
                {entry.fields.slice(0, 8).map((field) => (
                  <li key={field.path}>
                    <span className={local.fieldName}>{field.path}</span>
                    {field.kind === "added" ? (
                      <ins>{summarise(field.after)}</ins>
                    ) : field.kind === "removed" ? (
                      <del>{summarise(field.before)}</del>
                    ) : (
                      <span>
                        <del>{summarise(field.before)}</del> → <ins>{summarise(field.after)}</ins>
                      </span>
                    )}
                  </li>
                ))}
                {entry.fields.length > 8 && <li className={local.more}>and {entry.fields.length - 8} more</li>}
              </ul>
            )}
          </div>
        ))}
      </CardSection>
    </div>
  );
}
