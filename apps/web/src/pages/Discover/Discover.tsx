import { useListParams } from "#hooks/useListParams";
import { trpc } from "#/trpc";
import styles from "./Discover.module.css";
import TitleSearch from "./TitleSearch";
import ListSearch from "./ListSearch";

/**
 * What Discover can do before it is asked to do it.
 *
 * Asked once here rather than per tab, because both tabs need it and both
 * would otherwise render a setup prompt only after a request guaranteed to
 * fail — an error state standing in for a step the user simply hasn't done.
 */
export type DiscoverStatus = {
  tmdb: boolean;
  radarr: boolean;
  sonarr: boolean;
  mdblist: boolean;
  trakt: boolean;
};

const TABS = [
  { value: "", label: "Titles" },
  { value: "lists", label: "Lists" },
] as const;

/**
 * Finding something you don't have, and acting on it.
 *
 * Two tabs, because there are two kinds of thing worth finding and they have
 * different verbs. A **title** you send to Radarr or Sonarr. A **list** you
 * turn into a rule, so it keeps arriving. Sharing a search box between them
 * would mean one set of results answering two questions badly.
 *
 * The tab is URL state like every other filter on this page, so a link to
 * `?tab=lists&q=horror` reproduces what the sender was looking at.
 */
export default function Discover() {
  const { param, setParams } = useListParams({ sortKeys: ["relevance"] as const, defaultSortKey: "relevance" });
  const tab = param("tab") === "lists" ? "lists" : "";

  const statusQuery = trpc.discover.status.useQuery();

  const tabs = (
    <div className={styles.tabs} role="tablist" aria-label="What to search">
      {TABS.map((t) => (
        <button
          key={t.value || "titles"}
          type="button"
          role="tab"
          aria-selected={tab === t.value}
          className={tab === t.value ? styles.tabActive : styles.tab}
          // `q` and `type` are cleared on the way across: the two tabs search
          // different corpora, and carrying a title query into a list search
          // returns nothing while looking like the list search is broken.
          onClick={() => setParams({ tab: t.value, q: "", type: "" })}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const shared = { status: statusQuery.data, statusLoading: statusQuery.isLoading, tabs };
  return tab === "lists" ? <ListSearch {...shared} /> : <TitleSearch {...shared} />;
}
