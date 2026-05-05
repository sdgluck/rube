import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FadeImage from "#components/FadeImage";
import Spinner from "#components/Spinner";
import { trpc } from "#/trpc";
import previewStyles from "#pages/Preview.module.css";
import styles from "./Rules.module.css";

interface RulePreviewRowProps {
  ruleId: string;
  fallbackRatingKey: string;
}

export default function RulePreviewRow({ ruleId, fallbackRatingKey }: RulePreviewRowProps) {
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
        {listQuery.isLoading ? (
          <div className={styles.detailWrap}>
            <div className={styles.previewLoading}>
              <Spinner size="sm" /> Loading preview…
            </div>
          </div>
        ) : wrapperWidth == null ? null : (
          <div className={styles.previewStack} style={{ width: `${wrapperWidth}px` }}>
            {collections.map((c) => (
              <CollectionPreview key={c.ratingKey} ratingKey={c.ratingKey} title={c.title} />
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function CollectionPreview({ ratingKey, title }: { ratingKey: string; title: string }) {
  const navigate = useNavigate();
  const itemsQuery = trpc.collections.items.useQuery({ ratingKey });
  const items = itemsQuery.data ?? [];

  return (
    <div className={styles.previewBlock}>
      {title && (
        <h4 className={styles.previewBlockTitle}>
          {title}
          {itemsQuery.data && (
            <span className={styles.previewBlockMeta}>
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          )}
        </h4>
      )}
      {itemsQuery.isLoading && (
        <div className={styles.previewLoading}>
          <Spinner size="xs" /> Loading…
        </div>
      )}
      {itemsQuery.error && <div className={styles.errorBox}>Failed to load: {itemsQuery.error.message}</div>}
      {itemsQuery.data && items.length === 0 && <div className={styles.previewEmpty}>No items.</div>}
      {items.length > 0 && (
        <div className={styles.previewAbsolute}>
          {items.map((item) => {
            const src = item.thumb ? `/api/plex-image?path=${encodeURIComponent(item.thumb)}` : null;
            return (
              <div
                key={item.ratingKey}
                className={previewStyles.card}
                onClick={() => navigate(`/media/${item.ratingKey}`)}
              >
                <div className={previewStyles.posterWrap}>
                  {src ? (
                    <FadeImage className={previewStyles.poster} src={src} alt={item.title} loading="lazy" />
                  ) : (
                    <div className={previewStyles.posterPlaceholder}>No image</div>
                  )}
                </div>
                <div className={previewStyles.cardTitle} title={item.title}>
                  {item.title}
                </div>
                {item.year != null && <div className={previewStyles.cardMeta}>{item.year}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
