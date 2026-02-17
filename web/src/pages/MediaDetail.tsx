import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Collections.module.css";

export default function MediaDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();

  const detailQuery = trpc.media.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  if (detailQuery.isLoading) return <p>Loading...</p>;
  if (detailQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load media item</div>;

  const item = detailQuery.data;
  if (!item) return null;

  return (
    <div>
      <a
        href="#"
        className={styles.backLink}
        onClick={(e) => {
          e.preventDefault();
          navigate(-1);
        }}
      >
        &larr; Back to Media
      </a>

      <div className={styles.detailLayout}>
        <div className={styles.detailPoster}>
          {item.thumb ? (
            <img
              className={styles.detailPosterImg}
              src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
              alt={item.title}
            />
          ) : (
            <div className={styles.detailPosterPlaceholder}>No poster</div>
          )}
        </div>

        <div className={styles.detailMain}>
          <h2 className={styles.heading}>{item.title}</h2>

          <div className={styles.meta}>
            {item.year && <span>{item.year}</span>}
            <span>{item.type}</span>
            {item.addedAt && <span>Added: {new Date(item.addedAt * 1000).toLocaleDateString()}</span>}
          </div>

          {item.summary && <p>{item.summary}</p>}

          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>Collections ({item.collections.length})</legend>
            {item.collections.length === 0 ? (
              <p className={styles.hint}>Not in any collections.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  {item.collections.map((col) => (
                    <tr key={col.ratingKey}>
                      <td>{col.isLocal ? <Link to={`/collections/${col.ratingKey}`}>{col.title}</Link> : col.title}</td>
                      <td>{col.sectionTitle || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
