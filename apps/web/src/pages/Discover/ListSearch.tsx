import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "#/trpc";
import PageShell from "#components/PageShell";
import SearchInput from "#components/SearchInput";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import { ListSkeleton } from "#components/Skeleton";
import { useListParams } from "#hooks/useListParams";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { listSourceSeed } from "#lib/ruleSeed";
import { PROVIDER_LABELS, providerSettingsPath, describeList, type ListHit } from "#lib/lists";
import shared from "#/styles/shared.module.css";
import styles from "./ListSearch.module.css";
import ListPreview from "./ListPreview";

/** Same floor as the title search: one letter matches everything. */
const MIN_TERM = 2;

/**
 * Finding a curated list, and turning it into a rule.
 *
 * The other half of Discover. A title you send to an *Arr once; a list you
 * want to keep arriving, which means a `list_source` rule — so the verb here
 * is "create rule", not "add".
 *
 * **Only MDBList and Trakt are searched, and the page says so.** They are the
 * only two providers with a list-search endpoint: TMDb's lists are
 * fetch-by-id in both v3 and v4, and IMDb dropped list search from the site
 * entirely. Those two remain a paste-in on the rule wizard. Implying a search
 * covers everything and then quietly missing half of it is worse than naming
 * the two it does.
 *
 * With no search term this shows each provider's popular lists rather than an
 * empty prompt — a search box over a corpus you've never seen is a worse blank
 * page than a shelf, and both providers hand the shelf back for free.
 */
export default function ListSearch({
  status,
  statusLoading,
  tabs,
}: {
  status: { mdblist: boolean; trakt: boolean } | undefined;
  statusLoading: boolean;
  tabs: ReactNode;
}) {
  const { param, setParams } = useListParams({ sortKeys: ["relevance"] as const, defaultSortKey: "relevance" });
  const term = param("q");
  const debounced = useDebouncedValue(term, 300);
  const navigate = useNavigate();

  const [previewing, setPreviewing] = useState<ListHit | null>(null);

  const anyConfigured = !!status && (status.mdblist || status.trakt);
  const searching = debounced.trim().length >= MIN_TERM;

  const searchQuery = trpc.discover.lists.search.useQuery(
    { term: debounced },
    { enabled: searching && anyConfigured, placeholderData: keepPreviousData },
  );
  const topQuery = trpc.discover.lists.top.useQuery(undefined, { enabled: !searching && anyConfigured });

  const active = searching ? searchQuery : topQuery;
  const results = active.data?.results ?? [];

  function createRule(hit: ListHit) {
    navigate("/rules", {
      state: { ruleSeed: listSourceSeed({ provider: hit.provider, listId: hit.listId, name: hit.name }) },
    });
  }

  function body() {
    if (statusLoading) return <ListSkeleton />;

    if (!anyConfigured) {
      return (
        <EmptyState
          icon="list"
          title="No list providers configured"
          action={
            <>
              <Link to="/settings/databases/mdblist" className={shared.button}>
                Add MDBList
              </Link>{" "}
              <Link to="/settings/databases/trakt" className={shared.buttonSecondary}>
                Add Trakt
              </Link>
            </>
          }
        />
      );
    }

    if (active.isError) {
      return <ErrorState title="Couldn't search lists" error={active.error} onRetry={() => active.refetch()} />;
    }

    if (results.length === 0 && !active.isFetching) {
      return searching ? (
        <EmptyState icon="search" title="Nothing found" description={`No public list matches "${debounced}".`} />
      ) : (
        <EmptyState icon="list" title="No lists to show" description="Neither provider returned anything popular." />
      );
    }

    return (
      <>
        {/* A provider being down costs its results, not the tab — but say so,
            or a half-empty page looks like the search simply found less. */}
        {(active.data?.failed ?? []).length > 0 && (
          <p className={styles.notice}>
            {(active.data?.failed ?? []).map((p) => PROVIDER_LABELS[p]).join(" and ")} didn&rsquo;t answer, so these
            results are incomplete.
          </p>
        )}
        {(active.data?.unconfigured ?? []).length > 0 && (
          <p className={styles.notice}>
            {(active.data?.unconfigured ?? []).map((p) => PROVIDER_LABELS[p]).join(" and ")} isn&rsquo;t configured, so
            its lists aren&rsquo;t searched.{" "}
            <Link to={providerSettingsPath((active.data?.unconfigured ?? [])[0]!)}>Add a key</Link>
          </p>
        )}

        <ul className={styles.list}>
          {results.map((hit) => (
            <li key={`${hit.provider}:${hit.listId}`} className={styles.listCard}>
              <div className={styles.cardMain}>
                <div className={styles.cardHead}>
                  <span className={styles.name} title={hit.name}>
                    {hit.name}
                  </span>
                  <span className={styles.provider}>{PROVIDER_LABELS[hit.provider]}</span>
                </div>
                <div className={shared.cardMeta}>{describeList(hit)}</div>
                {hit.description && <p className={styles.description}>{hit.description}</p>}
              </div>
              <div className={styles.cardActions}>
                <button type="button" className={styles.ghostBtn} onClick={() => setPreviewing(hit)}>
                  Preview
                </button>
                <button type="button" className={styles.addBtn} onClick={() => createRule(hit)}>
                  Create rule
                </button>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <PageShell count={results.length > 0 ? String(results.length) : undefined}>
      {tabs}
      <div className={shared.filters}>
        <SearchInput
          value={term}
          onChange={(value) => setParams({ q: value })}
          placeholder="Search MDBList and Trakt lists…"
          grow
        />
      </div>

      {body()}

      {previewing && (
        <ListPreview
          hit={previewing}
          onClose={() => setPreviewing(null)}
          onCreateRule={() => {
            createRule(previewing);
            setPreviewing(null);
          }}
        />
      )}
    </PageShell>
  );
}
