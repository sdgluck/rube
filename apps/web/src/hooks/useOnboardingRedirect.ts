import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";

/**
 * Send a brand-new install to setup, once.
 *
 * `shouldRedirect` is latched off server-side by any of started / skipped /
 * dismissed — but *landing* on the wizard used to set none of those. Nothing is
 * recorded until the user presses Next or Skip, and the ref below is per mount,
 * so closing the tab and reopening the app redirected them again, indefinitely.
 * So the redirect records that it happened: arriving at setup is the start of
 * setup, which is the plainest reading of it, and it is what makes "once" true.
 */
export default function useOnboardingRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const fired = useRef(false);
  const statusQuery = trpc.onboarding.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const start = trpc.onboarding.start.useMutation();

  useEffect(() => {
    if (fired.current) return;
    if (!statusQuery.data?.shouldRedirect) return;
    if (location.pathname === "/onboarding") return;
    fired.current = true;
    // Fire and forget: a failed write costs one extra redirect next time, which
    // is a far better failure than refusing to show setup to a new install.
    start.mutate();
    navigate("/onboarding", { replace: true });
    // `start` is a stable mutation handle; including it would re-run this on
    // every render of the mutation's own state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data, location.pathname, navigate]);
}
