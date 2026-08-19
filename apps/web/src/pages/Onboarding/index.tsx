import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { PageSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";
import WelcomeStep from "./WelcomeStep";
import ConnectStep from "./ConnectStep";
import RulesStep from "./RulesStep";
import MigrateStep from "./MigrateStep";
import ScheduleStep from "./ScheduleStep";
import NotifyStep from "./NotifyStep";
import DryRunStep from "./DryRunStep";
import DoneStep from "./DoneStep";

/**
 * First-run setup, as a takeover rather than a page inside the app shell.
 *
 * The sidebar is deliberately absent: someone on their first visit has nothing
 * to navigate to yet, and a nav rail full of empty pages is an invitation to
 * wander off before Plex is connected. Skip is always one click away, and
 * because every step writes real config as it goes, leaving halfway costs
 * nothing — `onboarding.status` derives the rest from what actually got saved.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const statusQuery = trpc.onboarding.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const healthQuery = trpc.health.status.useQuery(undefined, { refetchOnWindowFocus: false });

  const setStep = trpc.onboarding.setStep.useMutation();
  const acknowledge = trpc.onboarding.acknowledge.useMutation();
  const skip = trpc.onboarding.skip.useMutation();
  const complete = trpc.onboarding.complete.useMutation();

  const status = statusQuery.data;
  const steps = useMemo(() => status?.steps ?? [], [status]);

  /**
   * The cursor is local while the wizard is open and only written back on
   * navigation. Driving it straight from the query would make every
   * invalidation — and there are many, since each step saves config — yank the
   * user back to whatever the server last recorded.
   */
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    if (cursor === null && status) setCursor(status.lastStepId);
  }, [cursor, status]);

  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === cursor),
  );
  const current = steps[index];
  const plexConnected = (healthQuery.data ?? []).some((s) => s.service === "Plex" && s.configured);
  const cfg = (configQuery.data ?? {}) as Record<string, unknown>;

  const goTo = useCallback(
    (stepId: string) => {
      setCursor(stepId);
      setStep.mutate({ stepId });
      window.scrollTo({ top: 0 });
    },
    [setStep],
  );

  async function handleNext() {
    if (!current) return;
    // Optional and not satisfied by config? Then moving on *is* the answer,
    // and the server records it so the step stops counting as outstanding.
    if (!current.complete && current.required) {
      addToast("Connect your Plex server to continue", "error");
      return;
    }
    if (!current.complete) {
      try {
        await acknowledge.mutateAsync({ stepId: current.id });
      } catch (err) {
        addToast((err as Error).message, "error");
        return;
      }
    }
    await utils.onboarding.status.invalidate();

    const next = steps[index + 1];
    if (!next) return;
    if (next.id === "done") {
      await complete.mutateAsync();
      await utils.onboarding.status.invalidate();
    }
    goTo(next.id);
  }

  async function handleSkipStep() {
    if (!current) return;
    try {
      await acknowledge.mutateAsync({ stepId: current.id });
      await utils.onboarding.status.invalidate();
    } catch (err) {
      addToast((err as Error).message, "error");
      return;
    }
    const next = steps[index + 1];
    if (next) goTo(next.id);
  }

  async function handleSkipAll() {
    await skip.mutateAsync();
    await utils.onboarding.status.invalidate();
    navigate("/stats");
  }

  if (statusQuery.isLoading || configQuery.isLoading) return <PageSkeleton />;
  if (statusQuery.error) {
    return (
      <div className={styles.page}>
        <ErrorState title="Couldn't load setup" error={statusQuery.error} onRetry={() => statusQuery.refetch()} />
      </div>
    );
  }
  if (!status || !current) return <PageSkeleton />;

  const isLast = index === steps.length - 1;

  function renderStep() {
    switch (current!.id) {
      case "welcome":
        return <WelcomeStep />;
      case "connect":
        return <ConnectStep cfg={cfg} plexConnected={plexConnected} />;
      case "migrate":
        return <MigrateStep />;
      case "rules":
        return <RulesStep />;
      case "schedule":
        return <ScheduleStep cfg={cfg} />;
      case "notify":
        return <NotifyStep cfg={cfg} />;
      case "dryrun":
        return <DryRunStep />;
      case "done":
        return <DoneStep />;
      default:
        return null;
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>Tinkerbell setup</span>
        <span className={styles.headerRight}>
          <span className={styles.headerCount}>
            {status.completedCount} of {status.totalCount} done
          </span>
          <button type="button" className={styles.skipAll} onClick={handleSkipAll} disabled={skip.isPending}>
            Skip for now →
          </button>
        </span>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Setup steps">
          <ol className={styles.railList}>
            {steps.map((step, i) => {
              const state = step.complete ? styles.railDone : i === index ? styles.railActive : "";
              // Back is always available; forward only as far as you've got,
              // so the rail can't be used to jump past a step that gates.
              const reachable = i <= index || step.complete;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`${styles.railItem} ${state}`}
                    onClick={() => reachable && goTo(step.id)}
                    disabled={!reachable}
                    aria-current={i === index ? "step" : undefined}
                  >
                    <span className={styles.railDot} aria-hidden="true">
                      {step.complete ? "✓" : i + 1}
                    </span>
                    <span className={styles.railLabel}>{step.label}</span>
                    {step.required && !step.complete && <span className={styles.railReq}>required</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className={styles.main}>
          <div key={current.id} className={styles.stepWrap}>
            {renderStep()}
          </div>

          <footer className={styles.footer}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
              onClick={() => index > 0 && goTo(steps[index - 1]!.id)}
              disabled={index === 0}
            >
              Back
            </button>
            <span className={styles.footerSpacer} />
            {!isLast && !current.complete && !current.required && (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                onClick={handleSkipStep}
                disabled={acknowledge.isPending}
              >
                Skip this step
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
                onClick={() => navigate("/stats")}
              >
                Go to dashboard
              </button>
            ) : (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
                onClick={handleNext}
                disabled={acknowledge.isPending || complete.isPending}
              >
                {current.required && !current.complete ? "Connect Plex to continue" : "Next"}
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}
