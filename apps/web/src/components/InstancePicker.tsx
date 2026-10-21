import { trpc } from "#/trpc";
import type { ArrService } from "@rube/contracts";
import styles from "./InstancePicker.module.css";

/**
 * "Which Radarr?"
 *
 * The primitive the whole Managers section rests on. A split 1080p/4K setup is
 * the norm in this community, so almost every list and every action needs to
 * say which instance it means — and "All" has to be a first-class answer,
 * because the unified page's entire reason to exist is showing them together.
 *
 * Bound to a URL search param rather than component state, so a filtered view
 * survives a reload and can be linked to.
 */
export default function InstancePicker({
  service,
  value,
  onChange,
  allowAll = true,
}: {
  service: ArrService;
  /** Undefined means "All". */
  value: string | undefined;
  onChange: (instanceId: string | undefined) => void;
  allowAll?: boolean;
}) {
  const instancesQuery = trpc.arr.instances.useQuery();
  const instances = (instancesQuery.data ?? []).filter((i) => i.service === service);

  // One instance is the common case, and a picker offering a single choice is
  // furniture with nothing to say. It reappears the moment a second is added.
  if (instances.length <= 1) return null;

  return (
    <div className={styles.picker} role="group" aria-label={`${service} instance`}>
      {allowAll && (
        <button
          type="button"
          className={value === undefined ? styles.active : styles.option}
          aria-pressed={value === undefined}
          onClick={() => onChange(undefined)}
        >
          All
        </button>
      )}
      {instances.map((instance) => (
        <button
          key={instance.id}
          type="button"
          className={value === instance.id ? styles.active : styles.option}
          aria-pressed={value === instance.id}
          onClick={() => onChange(instance.id)}
        >
          {instance.name}
        </button>
      ))}
    </div>
  );
}
