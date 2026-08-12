import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import FadeImage from "#components/FadeImage";
import styles from "#pages/Jobs/Jobs.module.css";
import CardSection from "#components/CardSection";

export default function GeneratedCollectionsPanel() {
  const utils = trpc.useUtils();
  const collectionsQuery = trpc.jobs.bywCollections.useQuery(undefined, { refetchInterval: 10000 });

  const deleteMutation = trpc.collections.delete.useMutation({
    onSuccess: () => utils.jobs.bywCollections.invalidate(),
  });

  const total = collectionsQuery.data?.reduce((n, g) => n + g.collections.length, 0);

  return (
    <CardSection
      className={styles.detailSection}
      titleClassName={styles.detailSectionTitle}
      title={
        <>
          Generated Collections
          {total !== undefined && <span className={styles.runMeta}>{` — ${total} total`}</span>}
        </>
      }
    >
      {collectionsQuery.isLoading ? (
        <p>Loading…</p>
      ) : collectionsQuery.error ? (
        <ErrorState
          inline
          title="Couldn't load generated collections"
          error={collectionsQuery.error}
          onRetry={() => collectionsQuery.refetch()}
        />
      ) : !collectionsQuery.data || collectionsQuery.data.length === 0 ? (
        <EmptyState
          icon="list"
          title="No collections yet"
          description="Run the job to generate Because You Watched collections."
        />
      ) : (
        <div className={styles.bywGroups}>
          {collectionsQuery.data.map((group) => (
            <details key={group.user} open className={styles.bywGroup}>
              <summary className={styles.bywGroupHeader}>
                {group.user} <span className={styles.runMeta}>({group.collections.length})</span>
              </summary>
              <div className={styles.bywGrid}>
                {group.collections.map((col) => (
                  <div key={col.plexRatingKey} className={styles.bywCard}>
                    <Link to={`/collections/${col.plexRatingKey}`} className={styles.bywCardLink}>
                      {col.thumb ? (
                        <FadeImage
                          className={styles.bywCardPoster}
                          src={`/api/plex-image?path=${encodeURIComponent(col.thumb)}`}
                          alt={col.title}
                          loading="lazy"
                        />
                      ) : (
                        <div className={styles.bywCardPosterPlaceholder}>No poster</div>
                      )}
                    </Link>
                    <div className={styles.bywCardBody}>
                      <div className={styles.bywCardTitle} title={col.title}>
                        {col.title}
                      </div>
                      <div className={styles.bywCardMeta}>
                        {col.sectionTitle} · {col.childCount} item{col.childCount !== 1 ? "s" : ""}
                        {col.addedAt ? (
                          <>
                            {" · "}
                            <RelativeTime timestamp={col.addedAt * 1000} />
                          </>
                        ) : null}
                      </div>
                      <button
                        className={`${styles.button} ${styles.buttonSmall} ${styles.buttonDanger}`}
                        onClick={() => {
                          if (confirm(`Delete "${col.title}"?`)) {
                            deleteMutation.mutate({ ratingKey: col.plexRatingKey });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </CardSection>
  );
}
