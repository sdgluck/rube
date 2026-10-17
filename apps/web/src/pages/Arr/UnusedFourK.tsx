import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import BulkBar from "#components/BulkBar";
import ConfirmModal from "#components/ConfirmModal";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell, { StatusChip, type StatusChipTone } from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import { MediaSkeleton } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import { EMPTY, formatFileSize } from "#/format";
import shared from "#/styles/shared.module.css";
import styles from "./UnusedFourK.module.css";

const STATE_LABEL: Record<string, { label: string; tone: StatusChipTone }> = {
  pending: { label: "Queued", tone: "advisory" },
  downloading: { label: "Downloading", tone: "running" },
  importing: { label: "Importing", tone: "running" },
  done: { label: "Replaced", tone: "ok" },
  failed: { label: "Failed", tone: "error" },
  cancelled: { label: "Cancelled", tone: "advisory" },
};

const ACTIVE = new Set(["pending", "downloading", "importing"]);

/**
 * Films kept in 4K that nobody has ever watched in 4K, and the swap to 1080p.
 *
 * The page leads with what the list is sure of and what it isn't: a film is
 * here only when every play on record was a transcode, and the play log only
 * reaches back so far. That sentence is the difference between a tool you
 * trust with your 4K library and one you don't.
 */
export default function UnusedFourK() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const candidatesQuery = trpc.qualitySwaps.candidates.useQuery(undefined, { refetchOnWindowFocus: false });
  const profilesQuery = trpc.qualitySwaps.profiles.useQuery(undefined, { refetchOnWindowFocus: false });
  const swapsQuery = trpc.qualitySwaps.swaps.useQuery(undefined, {
    // A swap moves every five minutes at most; a minute is plenty to look alive.
    refetchInterval: (q) => (q.state.data?.some((s) => ACTIVE.has(s.state)) ? 60_000 : false),
  });
  const startMutation = trpc.qualitySwaps.start.useMutation();
  const cancelMutation = trpc.qualitySwaps.cancel.useMutation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);

  // Default each instance to its first profile — the router sorts "1080" ones first.
  useEffect(() => {
    if (!profilesQuery.data) return;
    setProfiles((current) => {
      const next = { ...current };
      for (const p of profilesQuery.data)
        if (next[p.instanceId] == null && p.profiles[0]) next[p.instanceId] = p.profiles[0].id;
      return next;
    });
  }, [profilesQuery.data]);

  const items = candidatesQuery.data?.items ?? [];
  const keyOf = (c: { instanceId: string; arrMovieId: number }) => `${c.instanceId}:${c.arrMovieId}`;
  const chosen = items.filter((c) => selected.has(keyOf(c)));
  const chosenBytes = chosen.reduce((sum, c) => sum + (c.size ?? 0), 0);
  const totalBytes = useMemo(() => items.reduce((sum, c) => sum + (c.size ?? 0), 0), [items]);
  const instancesInSelection = [...new Set(chosen.map((c) => c.instanceId))];
  const multiInstance = (profilesQuery.data?.length ?? 0) > 1;

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const start = async () => {
    setConfirming(false);
    try {
      const result = await startMutation.mutateAsync({
        movies: chosen.map((c) => ({ instanceId: c.instanceId, arrMovieId: c.arrMovieId })),
        profiles,
      });
      addToast(
        result.skipped.length > 0
          ? `Queued ${result.queued}; ${result.skipped.length} no longer qualified`
          : `Queued ${result.queued} swap${result.queued === 1 ? "" : "s"}`,
        result.queued > 0 ? "success" : "error",
      );
      setSelected(new Set());
      await Promise.all([utils.qualitySwaps.candidates.invalidate(), utils.qualitySwaps.swaps.invalidate()]);
    } catch (err) {
      addToast((err as Error).message, "error");
    }
  };

  const cancel = async (id: string) => {
    const result = await cancelMutation.mutateAsync({ id });
    addToast(result.message, result.ok ? "success" : "error");
    await Promise.all([utils.qualitySwaps.candidates.invalidate(), utils.qualitySwaps.swaps.invalidate()]);
  };

  if (candidatesQuery.isLoading) return <MediaSkeleton />;
  if (candidatesQuery.error) {
    return (
      <ErrorState
        title="Couldn't look for unused 4K"
        error={candidatesQuery.error}
        onRetry={() => candidatesQuery.refetch()}
      />
    );
  }

  const coverage = candidatesQuery.data?.coverage;
  const swaps = swapsQuery.data ?? [];
  const missingProfile = instancesInSelection.some((id) => profiles[id] == null);

  return (
    <PageShell
      count={items.length > 0 ? String(items.length) : undefined}
      actions={totalBytes > 0 && <StatusChip tone="advisory">{formatFileSize(totalBytes)} in 4K</StatusChip>}
    >
      <p className={styles.intro}>
        4K films that nobody has watched in 4K: every play was a transcode, or there were none. Radarr can't downgrade a
        film by itself, so a swap sets a 1080p profile, grabs a 1080p release, and imports it over the 4K file once it
        has downloaded. The 4K copy stays until then, and a failed swap puts the profile back.
        {coverage && coverage.earliestAt != null && (
          <>
            {" "}
            Plays are known from <RelativeTime timestamp={coverage.earliestAt} /> on. A film with a play older than
            that, or one whose details weren't recorded, is left out.
          </>
        )}
      </p>

      {swaps.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Swaps</h3>
          <div className="table-scroll">
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>Film</th>
                  <th>State</th>
                  <th>Progress</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {swaps.map((s) => {
                  const st = STATE_LABEL[s.state] ?? { label: s.state, tone: "advisory" as const };
                  return (
                    <tr key={s.id}>
                      <td>{s.plexRatingKey ? <Link to={`/media/${s.plexRatingKey}`}>{s.title}</Link> : s.title}</td>
                      <td>
                        <StatusChip tone={st.tone}>{st.label}</StatusChip>
                      </td>
                      <td className={shared.cellMuted}>{s.message || EMPTY}</td>
                      <td className={shared.cellMuted}>
                        <RelativeTime timestamp={s.updatedAt} />
                      </td>
                      <td>
                        {(s.state === "pending" || s.state === "downloading") && (
                          <button
                            type="button"
                            className={styles.cancelLink}
                            onClick={() => cancel(s.id)}
                            disabled={cancelMutation.isPending}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon="film"
          title="No unused 4K"
          description="Every 4K film in Radarr has been played in 4K at least once, or was added in the last 30 days."
        />
      ) : (
        <section className={styles.section}>
          <div className={styles.toolbar}>
            {(profilesQuery.data ?? []).map((p) => (
              <label key={p.instanceId} className={styles.profilePick}>
                <span>{multiInstance ? `Swap to (${p.instanceName})` : "Swap to"}</span>
                <select
                  className={shared.select}
                  value={profiles[p.instanceId] ?? ""}
                  onChange={(e) => setProfiles((cur) => ({ ...cur, [p.instanceId]: Number(e.target.value) }))}
                >
                  {p.profiles.length === 0 && <option value="">No profiles synced</option>}
                  {p.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {selected.size > 0 && (
            <BulkBar
              count={selected.size}
              noun="film"
              onClear={() => setSelected(new Set())}
              actions={[
                {
                  label: `Swap to 1080p (${formatFileSize(chosenBytes)} in 4K)`,
                  tone: "primary",
                  disabled: missingProfile || startMutation.isPending,
                  title: missingProfile ? "Pick a profile to swap to first" : undefined,
                  onClick: () => setConfirming(true),
                },
              ]}
            />
          )}

          <div className="table-scroll">
            <table className={shared.table}>
              <thead>
                <tr>
                  <th className={shared.checkboxCell}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.size === items.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map(keyOf)) : new Set())}
                    />
                  </th>
                  <th>Film</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Plays</th>
                  <th>Last played</th>
                  {multiInstance && <th>Radarr</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={keyOf(c)}>
                    <td className={shared.checkboxCell}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.title}`}
                        checked={selected.has(keyOf(c))}
                        onChange={() => toggle(keyOf(c))}
                      />
                    </td>
                    <td>
                      <Link to={`/media/${c.ratingKey}`}>{c.title}</Link>
                      {c.year != null && <span className={shared.cellMuted}> {c.year}</span>}
                    </td>
                    <td className={shared.cellMuted}>{c.fileQuality || EMPTY}</td>
                    <td className={shared.cellMuted}>{c.size != null ? formatFileSize(c.size) : EMPTY}</td>
                    <td className={shared.cellMuted}>{c.plays === 0 ? "Never" : `${c.plays}, all transcoded`}</td>
                    <td className={shared.cellMuted}>
                      {c.lastPlayedAt ? <RelativeTime timestamp={c.lastPlayedAt} /> : EMPTY}
                    </td>
                    {multiInstance && <td className={shared.cellMuted}>{c.instanceName}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirming && (
        <ConfirmModal
          title={`Swap ${chosen.length} film${chosen.length === 1 ? "" : "s"} to 1080p?`}
          message={
            `Each film's 4K file is replaced by a 1080p download once it has finished — the 4K file is deleted then, ` +
            `or moved to Radarr's recycle bin if you have one. Swaps search one at a time, every five minutes.`
          }
          confirmLabel="Start swaps"
          danger
          onConfirm={start}
          onCancel={() => setConfirming(false)}
        />
      )}
    </PageShell>
  );
}
