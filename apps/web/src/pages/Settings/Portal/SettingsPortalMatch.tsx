/**
 * Settings → Portal → Movie match: the one switch for the portal's
 * "what shall we watch?" rooms.
 *
 * Its own page rather than a row on Components because it is more than a tab:
 * turning it on starts the portal if nothing else has, and lets people with no
 * account on this server in, as guests, on a room's invite link. That second
 * part is the thing an admin needs to read before they flip it, so it is said
 * here, next to the switch.
 *
 * Saves on toggle, like the Components switches.
 */
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import SettingsPageLink from "#components/SettingsPageLink";
import ToggleSwitch from "#components/ToggleSwitch";
import styles from "../Personalization.module.css";

export default function SettingsPortalMatch() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery();
  const saveMutation = trpc.config.save.useMutation();

  if (configQuery.error && !configQuery.data) {
    return (
      <ErrorState title="Couldn't load movie match" error={configQuery.error} onRetry={() => configQuery.refetch()} />
    );
  }
  if (!configQuery.data) return null;
  const enabled = configQuery.data.match_enabled === true;

  function setEnabled(on: boolean) {
    saveMutation.mutate(
      { match_enabled: on },
      {
        onSuccess: () => {
          utils.config.get.invalidate();
          utils.config.portalComponents.invalidate();
          addToast(on ? "Movie match is on" : "Movie match is off", "success");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <div className={styles.row}>
          <span className={styles.label}>Movie match</span>
          <ToggleSwitch checked={enabled} disabled={saveMutation.isPending} onChange={setEnabled} />
        </div>
        <p className={styles.hint}>
          Adds a Movie match tab to the portal. Someone makes a room from a movie library shared with them, everyone
          swipes through the same shuffled films, and anything the whole room likes is a match.
        </p>
        <ul className={styles.caveats}>
          <li>Only users of your Plex server can make a room, and only from libraries shared with them.</li>
          <li>
            A room&apos;s invite link lets <strong>anyone</strong> join as a guest with just a name, and see that
            room&apos;s films — titles, posters and synopses, not playback. Typing the room&apos;s four-letter code only
            works for users who already have its library.
          </li>
          <li>A room closes after 30 days without a visit, or when whoever made it loses access to its library.</li>
        </ul>
      </div>
      <div className={styles.card}>
        <span className={styles.label}>Inviting people from outside</span>
        <p className={styles.hint}>
          Guests open the invite link in a browser, so the portal has to be reachable from where they are. Set the
          address the link should use under{" "}
          <SettingsPageLink to="/settings/portal/address">Portal → Address</SettingsPageLink>.
        </p>
      </div>
    </div>
  );
}
