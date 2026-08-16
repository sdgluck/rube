import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";

/**
 * Send a brand-new install to setup, once.
 *
 * `shouldRedirect` is latched off server-side by any of started / skipped /
 * dismissed, so this can only ever fire on an install nobody has made a
 * decision about. The ref is a second belt: within a session, one redirect is
 * all anyone gets, so navigating away from `/onboarding` before the mutation
 * lands can't bounce them straight back.
 */
export default function useOnboardingRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const fired = useRef(false);
  const statusQuery = trpc.onboarding.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    if (fired.current) return;
    if (!statusQuery.data?.shouldRedirect) return;
    if (location.pathname === "/onboarding") return;
    fired.current = true;
    navigate("/onboarding", { replace: true });
  }, [statusQuery.data, location.pathname, navigate]);
}
