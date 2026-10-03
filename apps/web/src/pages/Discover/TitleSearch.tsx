import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { tmdbPosterUrl } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import SearchInput from "#components/SearchInput";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import FadeImage from "#components/FadeImage";
import { ListSkeleton } from "#components/Skeleton";
import { useListParams } from "#hooks/useListParams";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { presenceBadge, canAdd, holdingLink, libraryLink, type DiscoverResult } from "#lib/discover";
import shared from "#/styles/shared.module.css";
import styles from "./Discover.module.css";
import AddToArrModal from "./AddToArrModal";
import type { DiscoverStatus } from "./Discover";

/** TMDb needs something to work with, and one letter matches everything. */
const MIN_TERM = 2;

type Filter = "" | "movie" | "tv";

/**
 * Finding a title you don't have, and asking for it.
 *
 * The counterpart to `/movies` and `/tv`, which show what you already hold.
 * Both media types share one grid because the question "do I have this?" is
 * asked about a title, not about a category, and making somebody pick the
 * right tab before they can ask is a step that answers nothing.
 *
 * Results are TMDb's, annotated server-side with what your *Arrs and Plex hold
 * — which is the whole point. A search that cannot tell you "you already have
 * this in Radarr-4K" is a worse version of themoviedb.org.
 */
export default function TitleSearch({
  status,
  statusLoading,
  tabs,
}: {
  status: DiscoverStatus | undefined;
  statusLoading: boolean;
  tabs: ReactNode;
}) {
  const { param, setParams } = useListParams({ sortKeys: ["relevance"] as const, defaultSortKey: "relevance" });
  const term = param("q");
  const debounced = useDebouncedValue(term, 300);
  const filter = param("type") as Filter;

  const [adding, setAdding] = useState<DiscoverResult | null>(null);

  const searchQuery = trpc.discover.search.useQuery(
    { term: debounced },
    {
      enabled: debounced.trim().length >= MIN_TERM && status?.tmdb === true,
      placeholderData: keepPreviousData,
    },
  );

  const instancesQuery = trpc.arr.instances.useQuery();
  const instanceName = useMemo(() => {
    const map = new Map((instancesQuery.data ?? []).map((i) => [i.id, i.name]));
    return (id: string) => map.get(id) ?? id;
  }, [instancesQuery.data]);

  const utils = trpc.useUtils();

  const results = (searchQuery.data?.results ?? []).filter((r) => !filter || r.mediaType === filter);
  const searching = debounced.trim().length >= MIN_TERM;

  function body() {
    if (statusLoading) return <ListSkeleton />;

    if (status?.tmdb === false) {
      return (
        <EmptyState
          icon="cog"
          title="TMDb isn't configured"
          action={
            <Link to="/settings/databases/tmdb" className={shared.button}>
              Add a TMDb key
            </Link>
          }
        />
      );
    }

    if (status && !status.radarr && !status.sonarr) {
      return (
        <EmptyState
          icon="cog"
          title="No media managers configured"
          action={
            <Link to="/settings/arrs" className={shared.button}>
              Add Radarr or Sonarr
            </Link>
          }
        />
      );
    }

    if (!searching) {
      return (
        <EmptyState
          icon="search"
          title="Search for a film or a show"
          description="Results say whether you already have it."
        />
      );
    }

    if (searchQuery.isError) {
      return (
        <ErrorState title="Couldn't search TMDb" error={searchQuery.error} onRetry={() => searchQuery.refetch()} />
      );
    }

    if (results.length === 0 && !searchQuery.isFetching) {
      return <EmptyState icon="search" title="Nothing found" description={`TMDb has no match for "${debounced}".`} />;
    }

    return (
      <div className={shared.grid}>
        {results.map((result) => {
          const badge = presenceBadge(result, instanceName);
          const poster = tmdbPosterUrl(result.posterPath);
          const configured = result.service === "radarr" ? !!status?.radarr : !!status?.sonarr;
          const link = holdingLink(result);
          return (
            <div key={`${result.mediaType}:${result.tmdbId}`} className={styles.resultCard}>
              {poster ? (
                <FadeImage src={poster} alt="" className={shared.cardPoster} loading="lazy" />
              ) : (
                <div className={shared.cardPosterPlaceholder}>No poster</div>
              )}
              <div className={shared.cardTitle} title={result.title}>
                {result.title}
              </div>
              <div className={shared.cardMeta}>
                {result.year ?? "—"} · {result.mediaType === "movie" ? "Movie" : "TV"}
              </div>
              <div className={styles.cardAction}>
                {badge ? (
                  link ? (
                    <Link className={styles.badgeLink} to={link}>
                      <StatusChip tone={badge.tone}>{badge.label}</StatusChip>
                    </Link>
                  ) : result.inArr.length > 1 ? (
                    <Link className={styles.badgeLink} to={libraryLink(result)}>
                      <StatusChip tone={badge.tone}>{badge.label}</StatusChip>
                    </Link>
                  ) : (
                    <StatusChip tone={badge.tone}>{badge.label}</StatusChip>
                  )
                ) : canAdd(result, configured) ? (
                  <button type="button" className={styles.addBtn} onClick={() => setAdding(result)}>
                    Add
                  </button>
                ) : (
                  // Held by nothing, and the service it would go to isn't set
                  // up — say which, rather than offering a button that 412s.
                  <span className={shared.cellMuted}>No {result.service === "radarr" ? "Radarr" : "Sonarr"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <PageShell count={searching && results.length > 0 ? String(results.length) : undefined}>
      {tabs}
      <div className={shared.filters}>
        <SearchInput
          value={term}
          onChange={(value) => setParams({ q: value })}
          placeholder="Search films and shows…"
          grow
        />
        <div className={shared.filtersSpacer} />
        <select
          className={shared.select}
          value={filter}
          onChange={(e) => setParams({ type: e.target.value })}
          aria-label="Media type"
        >
          <option value="">Films and shows</option>
          <option value="movie">Films</option>
          <option value="tv">Shows</option>
        </select>
      </div>

      {body()}

      {adding && (
        <AddToArrModal
          result={adding}
          onClose={() => setAdding(null)}
          onAdded={() => {
            // The add wrote the record through to the mirror, so re-asking
            // turns this card's Add button into a presence chip immediately.
            void utils.discover.search.invalidate();
            void utils.arr.library.list.invalidate();
          }}
        />
      )}
    </PageShell>
  );
}
