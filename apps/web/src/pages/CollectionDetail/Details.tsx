import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import FadeImage from "#components/FadeImage";
import RelativeTime from "#components/RelativeTime";
import RunJobButton from "#components/RunJobButton";
import { useToast } from "#components/Toast";
import { SmartFilterSummary } from "#components/SmartFiltersEditor";
import styles from "#/styles/shared.module.css";
import { useCollection } from "./context.ts";
import local from "./CollectionDetail.module.css";
import { plexImageUrl } from "#lib/media";

/**
 * Plex's `collectionMode`. `-1` is the library's own default, which is a real
 * third state rather than "unset" — a collection can be explicitly told to show
 * its items while the library hides them.
 */
const MODES = [
  { value: -1, label: "Library default" },
  { value: 0, label: "Hide the collection" },
  { value: 1, label: "Hide items in the library" },
  { value: 2, label: "Show items in the library" },
] as const;

const SORTS = [
  { value: 0, label: "Release date" },
  { value: 1, label: "Alphabetical" },
  { value: 2, label: "Custom order" },
] as const;

function formatRuntime(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function Details() {
  const { ratingKey, isSmart, openFilters, refresh } = useCollection();
  const { addToast } = useToast();

  const statsQuery = trpc.collections.stats.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const relatedQuery = trpc.collections.related.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const smartConfigQuery = trpc.collections.smartConfig.useQuery(
    { ratingKey },
    { enabled: isSmart, refetchOnWindowFocus: false },
  );
  const prefsQuery = trpc.collections.prefs.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const setPrefs = trpc.collections.setPrefs.useMutation();

  const stats = statsQuery.data;
  const related = relatedQuery.data;

  type Prefs = Parameters<typeof setPrefs.mutateAsync>[0];
  const savePref = async (patch: Omit<Prefs, "ratingKey">) => {
    try {
      await setPrefs.mutateAsync({ ratingKey, ...patch });
      addToast("Saved to Plex", "success");
      prefsQuery.refetch();
      refresh();
    } catch {
      addToast("Plex refused the change", "error");
    }
  };

  return (
    <>
      {isSmart && smartConfigQuery.data?.content && (
        <CardSection title="Filter" className={styles.group} titleClassName={styles.groupTitle}>
          <SmartFilterSummary content={smartConfigQuery.data.content} onEdit={openFilters} />
        </CardSection>
      )}

      <CardSection title="At a glance" className={styles.group} titleClassName={styles.groupTitle}>
        {statsQuery.isLoading ? (
          <p className={styles.hint}>Counting…</p>
        ) : !stats || stats.knownItems === 0 ? (
          <div className={local.settingRow}>
            <p className={styles.hint}>No members in the media index yet.</p>
            <RunJobButton jobId="sync-media" small>
              Sync now
            </RunJobButton>
          </div>
        ) : (
          <>
            <div className={local.statStrip}>
              {/* Omitted rather than shown as "0m": Plex puts no duration on a
                  show row (it lives on the episodes), so a TV collection would
                  otherwise state a confident, wrong zero. */}
              {stats.totalRuntimeMs > 0 && (
                <div className={local.statCell}>
                  <span className={local.statValue}>{formatRuntime(stats.totalRuntimeMs)}</span>
                  <span className={local.statLabel}>Total runtime</span>
                </div>
              )}
              {stats.yearRange && (
                <div className={local.statCell}>
                  <span className={local.statValue}>
                    {stats.yearRange.from === stats.yearRange.to
                      ? stats.yearRange.from
                      : `${stats.yearRange.from}–${stats.yearRange.to}`}
                  </span>
                  <span className={local.statLabel}>Years</span>
                </div>
              )}
              {stats.watchedFraction !== null && (
                <div className={local.statCell}>
                  <span className={local.statValue}>{Math.round(stats.watchedFraction * 100)}%</span>
                  <span className={local.statLabel}>Watched</span>
                </div>
              )}
              <div className={local.statCell}>
                <span className={local.statValue}>{stats.knownItems.toLocaleString()}</span>
                <span className={local.statLabel}>Synced items</span>
              </div>
              {stats.performance && stats.performanceWindow.coveredDays > 0 && (
                <>
                  <div className={local.statCell}>
                    <span className={local.statValue}>{stats.performance.plays.toLocaleString()}</span>
                    <span className={local.statLabel}>Plays, {stats.performanceWindow.coveredDays}d</span>
                  </div>
                  <div className={local.statCell}>
                    <span className={local.statValue}>{stats.performance.viewers.toLocaleString()}</span>
                    <span className={local.statLabel}>Viewers</span>
                  </div>
                  <div className={local.statCell}>
                    <span className={local.statValue}>
                      {stats.performance.lastPlayedAt ? (
                        <RelativeTime timestamp={stats.performance.lastPlayedAt} />
                      ) : (
                        "Never"
                      )}
                    </span>
                    <span className={local.statLabel}>Last played</span>
                  </div>
                </>
              )}
            </div>
            {stats.performance && stats.performanceWindow.coveredDays > 0 && (
              // Said out loud because the obvious reading — "plays started from
              // this shelf" — is something Plex never reports.
              <p className={styles.hint}>
                Plays of its titles since they joined it, over the last {stats.performanceWindow.coveredDays} days.{" "}
                {stats.performance.members - stats.performance.playedMembers} of {stats.performance.members} haven't
                been played in that time.
              </p>
            )}
            {stats.topGenres.length > 0 && (
              <div className={local.badgeRow}>
                {stats.topGenres.map((g) => (
                  <span key={g.genre} className={styles.metaChip}>
                    {g.genre} {g.count}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </CardSection>

      <CardSection title="In Plex" className={styles.group} titleClassName={styles.groupTitle}>
        <div className={local.settingRow}>
          <div>
            <div className={local.settingName}>Library visibility</div>
            <div className={local.settingHelp}>Whether members also show on their own.</div>
          </div>
          <select
            className={styles.select}
            value={prefsQuery.data?.collectionMode ?? -1}
            onChange={(e) => savePref({ collectionMode: Number(e.target.value) as (typeof MODES)[number]["value"] })}
            disabled={setPrefs.isPending || prefsQuery.isLoading}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className={local.settingRow}>
          <div>
            <div className={local.settingName}>Item order</div>
          </div>
          <select
            className={styles.select}
            value={prefsQuery.data?.collectionSort ?? 0}
            onChange={(e) => savePref({ collectionSort: Number(e.target.value) as (typeof SORTS)[number]["value"] })}
            disabled={setPrefs.isPending || prefsQuery.isLoading}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </CardSection>

      {related && related.collections.length > 0 && (
        <CardSection
          title={`More from ${related.rule?.name ?? "this rule"}`}
          className={styles.group}
          titleClassName={styles.groupTitle}
        >
          <div className={local.relatedRow}>
            {related.collections.map((c) => (
              <Link key={c.plexRatingKey} to={`/collections/${c.plexRatingKey}`} className={local.relatedItem}>
                {c.thumb ? (
                  <FadeImage className={local.relatedPoster} src={plexImageUrl(c.thumb)} alt={c.title} loading="lazy" />
                ) : (
                  <div className={local.relatedEmpty} />
                )}
                <div className={local.relatedTitle} title={c.title}>
                  {c.title}
                </div>
              </Link>
            ))}
          </div>
        </CardSection>
      )}
    </>
  );
}
