import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import PageShell from "#components/PageShell";
import MultiSelect from "#components/MultiSelect";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import { SkeletonTable } from "#components/Skeleton";
import SearchInput from "#components/SearchInput";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import styles from "./Changes.module.css";

/**
 * What Tinkerbell did to the library, and what can be taken back.
 *
 * Every one of these changes was already recorded, and every one was recorded
 * somewhere else — collection membership on the rule's runs page, metadata
 * writes on the Metadata page, deletions on the Cleanup queue, deleted rules
 * in a recycle bin nobody knows exists. None of those pages can answer the
 * question anyone actually has the morning after a bad night, which is not
 * "what did the metadata rule do" but "what changed, and can I have it back?"
 *
 * The page is deliberately honest about the second half. Most of these cannot
 * be undone, and a row saying so — with the nearest useful alternative — is
 * worth more than an Undo button that opens a dialogue explaining it isn't one.
 */

const KIND_OPTIONS = [
  { value: "cleanup", label: "Deletions & cleanup" },
  { value: "metadata", label: "Metadata writes" },
  { value: "collection", label: "Collection membership" },
  { value: "overlay", label: "Poster overlays" },
  { value: "rule", label: "Deleted rules" },
];

const KIND_LABEL: Record<string, string> = {
  collection: "Collection",
  metadata: "Metadata",
  cleanup: "Cleanup",
  rule: "Rule",
  overlay: "Overlay",
};

const KIND_CLASS: Record<string, string> = {
  collection: styles.kindCollection,
  metadata: styles.kindMetadata,
  cleanup: styles.kindCleanup,
  rule: styles.kindRule,
  overlay: styles.kindOverlay,
};

export default function Changes() {
  const [kinds, setKinds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { addToast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const query = trpc.changes.feed.useQuery(
    { limit: 200, kinds: kinds.length > 0 ? (kinds as never) : undefined },
    { refetchOnWindowFocus: false },
  );

  const undo = trpc.changes.undo.useMutation({
    onSuccess: (res) => {
      utils.changes.feed.invalidate();
      utils.rules.list.invalidate();
      if (res.started) {
        // The undo mutation doesn't hand back a run id, so this opens the job,
        // whose page leads with its newest run.
        addToast("Undo started", "success", {
          action: { label: "View job", onAction: () => navigate("/jobs/metadata-undo") },
        });
      } else {
        addToast("Rule restored", "success");
      }
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const entries = query.data?.entries ?? [];

  // Filtered in the browser rather than in SQL: the feed is a merge across
  // five tables, so a server-side text filter would have to be written five
  // times and would still be applied before the merge cut the page.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        e.detail.toLowerCase().includes(needle) ||
        (e.ruleName ?? "").toLowerCase().includes(needle),
    );
  }, [entries, search]);

  if (query.error) {
    return <ErrorState title="Couldn't load recent changes" error={query.error} onRetry={() => query.refetch()} />;
  }

  return (
    <PageShell count={query.data ? rows.length : undefined}>
      <div className={styles.filters}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search titles, rules…" />
        <MultiSelect
          allLabel="Everything"
          ariaLabel="Kinds of change"
          options={KIND_OPTIONS}
          selected={kinds}
          onChange={setKinds}
        />
      </div>

      {query.isLoading ? (
        <SkeletonTable rows={10} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon="list" title="Nothing has changed" />
      ) : (
        <div className="table-scroll" data-scroll="x">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>What</th>
                <th>Rule</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={shared.cellMuted}>
                    <RelativeTime timestamp={row.at} />
                  </td>
                  <td>
                    <span className={`${styles.kind} ${KIND_CLASS[row.kind] ?? ""}`}>
                      {KIND_LABEL[row.kind] ?? row.kind}
                    </span>
                  </td>
                  <td>
                    <span className={styles.title}>
                      {row.href ? <Link to={row.href}>{row.title}</Link> : row.title}
                    </span>
                    <br />
                    <span className={styles.detail}>{row.detail}</span>
                  </td>
                  <td className={styles.rule}>{row.ruleName ?? "—"}</td>
                  <td className={styles.actionsCell}>
                    {row.undo === "none" ? (
                      <span className={styles.noUndo}>{row.irreversibleNote ?? "No undo"}</span>
                    ) : (
                      <button
                        type="button"
                        className={shared.buttonSecondary}
                        disabled={undo.isPending}
                        onClick={() => undo.mutate({ kind: row.undo as never, ref: row.undoRef! })}
                      >
                        {row.undo === "restore-rule" ? "Restore" : "Undo"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
