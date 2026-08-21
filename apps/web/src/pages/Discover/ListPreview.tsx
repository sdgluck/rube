import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import Spinner from "#components/Spinner";
import ErrorState from "#components/ErrorState";
import { StatusChip } from "#components/PageShell";
import { presenceBadge } from "#lib/discover";
import { describeHoldings, PROVIDER_LABELS, type ListHit } from "#lib/lists";
import shared from "#/styles/shared.module.css";
import controls from "#/styles/controls.module.css";
import styles from "./ListPreview.module.css";

/**
 * What is in a list, before you commit to a rule for it.
 *
 * Text rows rather than a poster grid, deliberately: neither MDBList nor Trakt
 * returns poster art dependably, and backfilling it from TMDb would be a
 * hundred calls every time somebody opened this. The number people actually
 * want is the summary line — how much of the list you already hold — and that
 * needs no artwork at all.
 *
 * Capped server-side at one screenful. This answers "is this the list I think
 * it is, and would a rule for it build anything?"; nobody reads item 400. The
 * rule fetches the whole list when it runs.
 */
export default function ListPreview({
  hit,
  onClose,
  onCreateRule,
}: {
  hit: ListHit;
  onClose: () => void;
  onCreateRule: () => void;
}) {
  const query = trpc.discover.lists.preview.useQuery({ provider: hit.provider, listId: hit.listId });
  const items = query.data?.items ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={hit.name}
      meta={PROVIDER_LABELS[hit.provider]}
      size="md"
      footer={
        <div className={styles.footer}>
          <button type="button" className={controls.btnGhost} onClick={onClose}>
            Close
          </button>
          <button type="button" className={controls.btnPrimary} onClick={onCreateRule}>
            Create rule
          </button>
        </div>
      }
    >
      {query.isPending ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorState title="Couldn't read this list" error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <p className={styles.summary}>{describeHoldings(items, query.data?.truncated ?? false)}</p>
          <ul className={styles.items}>
            {items.map((item, index) => {
              const badge = presenceBadge(item);
              return (
                // Position, not an id: an entry can carry only an IMDb id, and
                // two entries can legitimately name the same title.
                <li key={index} className={styles.item}>
                  <span className={styles.itemTitle} title={item.title}>
                    {item.title}
                  </span>
                  <span className={shared.cellMuted}>
                    {item.year ?? "—"} · {item.mediaType === "movie" ? "Movie" : "TV"}
                  </span>
                  {badge ? <StatusChip tone={badge.tone}>{badge.label}</StatusChip> : <span />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
