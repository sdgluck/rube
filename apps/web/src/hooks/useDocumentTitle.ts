import { useEffect } from "react";
import { trpc } from "#/trpc";

export default function useDocumentTitle() {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, {
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });

  const count = sessionsQuery.data?.length || 0;

  useEffect(() => {
    if (count > 0) {
      document.title = `Tinkerbell (${count} stream${count !== 1 ? "s" : ""})`;
    } else {
      document.title = "Tinkerbell";
    }
  }, [count]);
}
