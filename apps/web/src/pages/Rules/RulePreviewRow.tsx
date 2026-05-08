import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PreviewHubRow, PreviewHubRowSkeleton, type HubItem } from "#components/PreviewHubRow";
import { trpc } from "#/trpc";
import styles from "./Rules.module.css";

interface RulePreviewRowProps {
  ruleId: string;
  fallbackRatingKey: string;
}

export default function RulePreviewRow({ ruleId, fallbackRatingKey }: RulePreviewRowProps) {
  // Lock the preview's width to the visible scroll-wrapper width so the
  // horizontally-scrolling card row doesn't push the parent table wider
  // than the viewport. Without this, the td expands to fit content and
  // forces the entire table to overflow horizontally.
  const [tdEl, setTdEl] = useState<HTMLTableCellElement | null>(null);
  const [wrapperWidth, setWrapperWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!tdEl) return;
    const wrapper = tdEl.closest<HTMLElement>(".table-scroll");
    if (!wrapper) return;
    const update = () => setWrapperWidth(wrapper.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [tdEl]);

  const listQuery = trpc.collections.list.useQuery({ label: `Rule:${ruleId}`, limit: 50 });
  const collections =
    listQuery.data && listQuery.data.items.length > 0
      ? listQuery.data.items.map((c) => ({ ratingKey: c.plexRatingKey, title: c.title }))
      : [{ ratingKey: fallbackRatingKey, title: "" }];

  return (
    <tr className={styles.detailRow}>
      <td ref={setTdEl} colSpan={7} className={styles.previewBlockCell}>
        <div className={styles.previewStack} style={wrapperWidth ? { width: `${wrapperWidth}px` } : undefined}>
          {listQuery.isLoading ? (
            <>
              <PreviewHubRowSkeleton />
              <PreviewHubRowSkeleton />
            </>
          ) : (
            collections.map((c) => <CollectionPreview key={c.ratingKey} ratingKey={c.ratingKey} title={c.title} />)
          )}
        </div>
      </td>
    </tr>
  );
}

function CollectionPreview({ ratingKey, title }: { ratingKey: string; title: string }) {
  const navigate = useNavigate();
  const itemsQuery = trpc.collections.items.useQuery({ ratingKey });
  const items: HubItem[] = itemsQuery.data ?? [];

  if (itemsQuery.isLoading) {
    return <PreviewHubRowSkeleton showTitle={!!title} />;
  }
  if (itemsQuery.error) {
    return <div className={styles.errorBox}>Failed to load: {itemsQuery.error.message}</div>;
  }
  if (items.length === 0) {
    return <div className={styles.previewEmpty}>No items.</div>;
  }
  return (
    <PreviewHubRow
      title={title || undefined}
      items={items}
      onItemClick={(item) => navigate(`/media/${item.ratingKey}`)}
    />
  );
}
