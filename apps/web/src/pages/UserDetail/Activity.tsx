import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import { SkeletonTable } from "#components/Skeleton";
import shared from "#/styles/shared.module.css";
import { useUserDetail } from "./context.ts";
import local from "./UserDetail.module.css";

const PAGE_SIZE = 50;

export default function Activity() {
  const { userId } = useUserDetail();

  // Plex's own history rather than Tinkerbell's playback log: it goes back
  // further than the poller has been running, and this page is asking what
  // the *user* watched, not what Tinkerbell happened to observe.
  const query = trpc.users.history.useQuery({ userId, offset: 0, limit: PAGE_SIZE }, { refetchOnWindowFocus: false });

  if (query.isLoading) return <SkeletonTable />;
  if (query.error)
    return <ErrorState title="Couldn't load history" error={query.error} onRetry={() => query.refetch()} />;

  const items = query.data ?? [];
  if (items.length === 0) {
    return <EmptyState icon="film" title="Nothing watched yet" />;
  }

  return (
    <div className="table-scroll">
      <table className={shared.table}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Watched</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={`${item.ratingKey}-${item.viewedAt ?? i}`}>
              <td data-cell="title">
                {item.ratingKey ? (
                  <Link to={`/media/${item.ratingKey}`} className={shared.cellLink}>
                    {item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title}
                  </Link>
                ) : (
                  (item.grandparentTitle ?? item.title)
                )}
              </td>
              <td data-cell="meta" className={local.dim}>
                {item.type}
              </td>
              <td data-cell="meta">
                {item.viewedAt ? (
                  <RelativeTime timestamp={item.viewedAt} seconds />
                ) : (
                  <span className={local.dim}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
