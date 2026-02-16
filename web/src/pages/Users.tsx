import { trpc } from "../trpc";
import styles from "./Users.module.css";

export default function Users() {
  const usersQuery = trpc.users.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  if (usersQuery.isLoading) return <p>Loading...</p>;
  if (usersQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load users</div>;

  const users = usersQuery.data || [];

  return (
    <div>
      <h2 className={styles.heading}>Users</h2>

      {users.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No shared users found.</p>
          <p className={styles.hint}>Users will appear here once Plex sharing is configured.</p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Label</th>
              <th>Collections</th>
              <th>Last Watched</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>
                  <span className={`${styles.label} ${styles.labelUser}`}>{user.label}</span>
                </td>
                <td>{user.collectionCount}</td>
                <td>
                  {user.lastWatched ? (
                    <div>
                      <div>{user.lastWatched.title}</div>
                      <div className={styles.hint}>
                        {new Date(user.lastWatched.viewedAt * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  ) : (
                    <span className={styles.hint}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
