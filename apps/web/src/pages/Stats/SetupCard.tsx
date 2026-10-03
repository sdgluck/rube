import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import controls from "#/styles/controls.module.css";

/**
 * The dismissed banner's replacement.
 *
 * Dismissing the top-of-app strip means "stop putting this in front of me on
 * every page", not "I am never finishing setup". Somewhere still has to say
 * the install is half-configured, and the dashboard is the honest place for it
 * — it is the page whose empty panels are the symptom.
 *
 * Renders nothing while the banner is still showing, so the two are never on
 * screen together.
 */
export default function SetupCard() {
  const statusQuery = trpc.onboarding.status.useQuery(undefined, { retry: false });
  const status = statusQuery.data;

  if (!status || status.complete || status.dismissedAt == null) return null;

  const needsPlex = status.missingRequired.includes("connect");
  return (
    <Banner
      variant={status.missingRequired.length > 0 ? "warn" : "info"}
      actions={
        <Link to="/onboarding" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}>
          {needsPlex ? "Connect Plex" : "Finish setup"}
        </Link>
      }
    >
      <strong>
        Setup is {status.completedCount} of {status.totalCount} done
      </strong>
      {needsPlex ? " — these panels need Plex." : null}
    </Banner>
  );
}
