/**
 * Settings → Portal → Components: what shared users see in the portal.
 *
 * The portal used to show every tab and section to everyone — a server with
 * cleanup off still offered "Leaving soon", which could only ever say nothing
 * was leaving. Each switch here is one component; a component also needs the
 * feature behind it, and when that's missing the row says which and links to
 * it, rather than showing a switch that looks on and does nothing.
 *
 * Saves on toggle, like the Features panel's switches: there's nothing to
 * compose across rows, and a Save button would be one more thing to forget.
 */
import { PORTAL_COMPONENTS, type PortalComponentGroup, type PortalPrerequisite } from "@rube/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import SettingsPageLink from "#components/SettingsPageLink";
import ToggleSwitch from "#components/ToggleSwitch";
import base from "../Personalization.module.css";
import styles from "./SettingsPortalComponents.module.css";

const GROUPS: Array<{ id: PortalComponentGroup; title: string }> = [
  { id: "tabs", title: "Tabs" },
  { id: "tastes", title: "Your tastes" },
  { id: "actions", title: "Actions" },
];

const PREREQUISITES: Record<PortalPrerequisite, { label: string; to: string }> = {
  cleanup: { label: "Needs cleanup turned on", to: "/settings/cleanup" },
  smtp: { label: "Needs email (SMTP)", to: "/settings/notifications/smtp" },
  match: { label: "Needs movie match turned on", to: "/settings/portal/match" },
};

export default function SettingsPortalComponents() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const statesQuery = trpc.config.portalComponents.useQuery();
  const configQuery = trpc.config.get.useQuery();
  const saveMutation = trpc.config.save.useMutation();

  if ((statesQuery.error && !statesQuery.data) || (configQuery.error && !configQuery.data)) {
    const error = statesQuery.error ?? configQuery.error!;
    return (
      <ErrorState
        title="Couldn't load the portal's components"
        error={error}
        onRetry={() => {
          statesQuery.refetch();
          configQuery.refetch();
        }}
      />
    );
  }
  const states = statesQuery.data;
  if (!states || !configQuery.data) return null;

  const hidden = configQuery.data.portal_components_hidden ?? [];

  function setEnabled(id: string, enabled: boolean) {
    const next = enabled ? hidden.filter((h) => h !== id) : [...hidden, id];
    saveMutation.mutate(
      { portal_components_hidden: next },
      {
        onSuccess: () => {
          utils.config.get.invalidate();
          utils.config.portalComponents.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  return (
    <div className={base.stack}>
      {GROUPS.map((group) => (
        <div key={group.id} className={base.card}>
          <span className={base.label}>{group.title}</span>
          <ul className={styles.componentList}>
            {PORTAL_COMPONENTS.filter((c) => c.group === group.id).map((c) => {
              const state = states[c.id];
              // Switched on, but its tab is off or its feature is missing —
              // dimmed so the switch doesn't read as "users see this".
              const blocked = state.enabled && !state.on;
              return (
                <li key={c.id} className={`${styles.componentRow} ${blocked ? styles.componentBlocked : ""}`}>
                  <span className={styles.componentName}>{c.label}</span>
                  {state.unmet ? (
                    <SettingsPageLink to={PREREQUISITES[state.unmet].to}>
                      {PREREQUISITES[state.unmet].label}
                    </SettingsPageLink>
                  ) : (
                    blocked && <span className={base.hint}>Its tab is off</span>
                  )}
                  <ToggleSwitch
                    size="sm"
                    checked={state.enabled}
                    disabled={saveMutation.isPending}
                    onChange={(on) => setEnabled(c.id, on)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
