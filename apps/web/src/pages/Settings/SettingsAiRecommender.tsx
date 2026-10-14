/**
 * Settings → AI → Built-in recommender: the switch for ranking Because You
 * Watched and We Think You'd Like with the bundled model.
 *
 * On this page rather than its own because it changes what the provider above
 * is asked to do — with both on, the LLM reranks a shortlist instead of
 * reading the library — and because it is what makes those two features work
 * with no provider at all, which is the first thing someone without one needs
 * to read.
 *
 * Saves on toggle, like the portal's Movie match switch. The attribution is
 * shown, not tucked away: MovieLens' licence asks for it wherever the derived
 * data is used.
 */
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import CardSection from "#components/CardSection";
import ToggleSwitch from "#components/ToggleSwitch";
import styles from "./Settings.module.css";

export default function SettingsAiRecommender({ enabled, hasProvider }: { enabled: boolean; hasProvider: boolean }) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const statusQuery = trpc.recommendations.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const status = statusQuery.data;

  function setEnabled(on: boolean) {
    saveMutation.mutate(
      { recommender_enabled: on },
      {
        onSuccess: () => {
          utils.config.get.invalidate();
          utils.recommendations.status.invalidate();
          addToast(on ? "Built-in recommender is on" : "Built-in recommender is off", "success");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  return (
    <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Built-in recommender">
      <label className={styles.field}>
        <span className={styles.label}>Rank Because You Watched and We Think You&apos;d Like locally</span>
        <div>
          <ToggleSwitch
            checked={enabled}
            disabled={saveMutation.isPending || (status !== undefined && !status.available)}
            onChange={setEnabled}
          />
        </div>
      </label>
      <p className={styles.hint}>
        {hasProvider
          ? "Ranks each library for each person from what they've watched, then asks the provider above to choose from the closest 150 titles rather than the whole library. Faster, cheaper, and it works with small local models."
          : "Ranks each library for each person from what they've watched, and builds both rows from that ranking — no AI provider needed."}{" "}
        Everything happens on this server: the model ships with Tinkerbell, and no viewing history is sent anywhere.
      </p>
      {status && !status.available && (
        <span className={`${styles.status} ${styles.statusWarn}`}>
          <span className={styles.statusDot} />
          {status.error}
        </span>
      )}
      {status?.available && status.model && (
        <>
          <span className={`${styles.status} ${enabled ? styles.statusOk : ""}`}>
            <span className={styles.statusDot} />
            Model v{status.model.version} · {status.model.count.toLocaleString()} films and series
          </span>
          <p className={styles.hint}>{status.model.attribution}</p>
        </>
      )}
    </CardSection>
  );
}
