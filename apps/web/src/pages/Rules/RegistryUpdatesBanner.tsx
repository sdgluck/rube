import { useState } from "react";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";

/**
 * Surfaces registry packs that have published a newer version of a rule this
 * instance imported.
 *
 * Updates are offered, never applied automatically — a registry bump is remote
 * content changing what runs against somebody's Plex server. Rules the user
 * has since edited are counted separately and excluded from "Update all":
 * their own edits outrank ours, and silently reverting them would be the
 * worst possible behaviour for a feature that pulls from the internet.
 */
export default function RegistryUpdatesBanner() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);

  const updates = trpc.registry.updates.useQuery(undefined, {
    refetchOnWindowFocus: false,
    // The registry being unreachable is not worth an error on the Rules page.
    retry: false,
  });
  const applyUpdate = trpc.registry.applyUpdate.useMutation();

  const all = updates.data ?? [];
  if (all.length === 0) return null;

  const updatable = all.filter((u) => !u.locallyModified);
  const modified = all.filter((u) => u.locallyModified);

  const handleUpdateAll = async () => {
    setBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const update of updatable) {
      try {
        await applyUpdate.mutateAsync({ ruleId: update.ruleId });
        ok++;
      } catch (err) {
        failures.push(`${update.ruleName}: ${(err as Error).message ?? err}`);
      }
    }
    await Promise.all([utils.registry.updates.invalidate(), utils.rules.list.invalidate()]);
    setBusy(false);

    if (ok > 0) addToast(`Updated ${ok} rule${ok === 1 ? "" : "s"} from the registry`, "success");
    // Report failures individually — "3 failed" tells the user nothing about
    // which rule to go and look at.
    for (const failure of failures) addToast(failure, "error");
  };

  return (
    <Banner
      variant="info"
      actions={
        updatable.length > 0 ? (
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
            onClick={handleUpdateAll}
            disabled={busy}
          >
            {busy ? "Updating…" : `Update ${updatable.length}`}
          </button>
        ) : undefined
      }
    >
      {updatable.length > 0 && (
        <>
          <strong>{updatable.length}</strong> imported rule{updatable.length === 1 ? " has" : "s have"} a newer version
          in the registry.
        </>
      )}
      {modified.length > 0 && (
        <>
          {updatable.length > 0 ? " " : ""}
          <strong>{modified.length}</strong> other{modified.length === 1 ? "" : "s"} changed upstream but{" "}
          {modified.length === 1 ? "has" : "have"} local edits, so {modified.length === 1 ? "it's" : "they're"} left
          alone.
        </>
      )}
    </Banner>
  );
}
