/**
 * "Try it": run an AI feature once, for real, without touching Plex.
 *
 * The bill and the failures both used to show up the morning after — a
 * nightly run was the only way to learn what a provider or model change did.
 * This runs the same code path as the job against one person and one library,
 * and shows the answer next to what each call cost, so a change can be judged
 * before it runs fifty times overnight.
 *
 * Running totals live in the usage panel; this is one experiment's numbers.
 *
 * The test runs in the background and this polls it, showing each step as it
 * happens: one request held open for minutes was cut off by reverse proxies,
 * and a spinner that then failed said nothing about which step was slow.
 */
import { useEffect, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tinkerbell/trpc";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import styles from "./Settings.module.css";
import own from "./SettingsAiTry.module.css";

type Status = inferRouterOutputs<AppRouter>["aiPreview"]["becauseYouWatched"]["status"];
type Preview = NonNullable<Status["result"]>;

const nf = new Intl.NumberFormat("en-GB");

export default function SettingsAiTry({ unsavedChanges }: { unsavedChanges: boolean }) {
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const usersQuery = trpc.users.list.useQuery(
    { limit: 200, offset: 0, sortDir: "asc" },
    { refetchOnWindowFocus: false, retry: false },
  );
  const start = trpc.aiPreview.becauseYouWatched.start.useMutation();
  const cancel = trpc.aiPreview.becauseYouWatched.cancel.useMutation();
  const [runId, setRunId] = useState<string | null>(null);
  const status = trpc.aiPreview.becauseYouWatched.status.useQuery(
    { id: runId ?? "" },
    {
      enabled: runId !== null,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (q) => (q.state.data && q.state.data.state !== "running" ? false : 1000),
    },
  );
  const run = status.data;
  const running = start.isPending || run?.state === "running";

  // A test started before a reload is still running on the server; pick it
  // back up. Asked once on mount — after that, the test this page starts is
  // the one it follows.
  const active = trpc.aiPreview.becauseYouWatched.active.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const sections = useMemo(
    () => (sectionsQuery.data ?? []).filter((s) => s.type === "movie" || s.type === "show"),
    [sectionsQuery.data],
  );
  const [sectionKey, setSectionKey] = useState("");
  const [plexUsername, setPlexUsername] = useState("");
  const [watchedTitle, setWatchedTitle] = useState("");
  const [count, setCount] = useState(2);

  const effectiveSection = sectionKey || sections[0]?.key || "";

  useEffect(() => {
    const resumed = active.data;
    if (!resumed || runId !== null) return;
    setRunId(resumed.id);
    setSectionKey(resumed.input.sectionKey);
    setPlexUsername(resumed.input.plexUsername ?? "");
    setWatchedTitle(resumed.input.watchedTitle ?? "");
    if (resumed.input.count) setCount(resumed.input.count);
    // Only the first answer matters; a later run id is this page's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.data]);

  async function handleRun() {
    setRunId(null);
    try {
      const { id } = await start.mutateAsync({
        sectionKey: effectiveSection,
        plexUsername: plexUsername || undefined,
        watchedTitle: watchedTitle.trim() || undefined,
        count: watchedTitle.trim() ? 1 : count,
      });
      setRunId(id);
    } catch {
      // Shown from the mutation's error below.
    }
  }

  const error = start.error?.message ?? status.error?.message ?? (run?.state !== "done" ? run?.error : null);

  return (
    <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Try it: Because you watched">
      <p className={styles.hint}>
        Builds &ldquo;Because you watched&rdquo; rows the way tonight&rsquo;s run would and shows the answer and what
        each call cost. Nothing is written to Plex, but the model calls are real and are billed like any other.
        {unsavedChanges && " It uses the saved provider — save your changes above first."}
      </p>

      <div className={own.pickers}>
        <label className={styles.field}>
          <span className={styles.label}>Library</span>
          <select className={styles.input} value={effectiveSection} onChange={(e) => setSectionKey(e.target.value)}>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Whose history</span>
          <select className={styles.input} value={plexUsername} onChange={(e) => setPlexUsername(e.target.value)}>
            <option value="">Whole server</option>
            {(usersQuery.data?.items ?? []).map((u) => (
              <option key={u.userId} value={u.username ?? ""}>
                {u.name || u.username}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>
          Watched title <em>(optional)</em>
        </span>
        <input
          type="text"
          className={styles.input}
          placeholder="Blank uses their most recent"
          value={watchedTitle}
          onChange={(e) => setWatchedTitle(e.target.value)}
        />
      </label>

      {!watchedTitle.trim() && (
        <label className={styles.field}>
          <span className={styles.label}>Recent titles to try</span>
          <select className={styles.input} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2 — the second shows the library read from cache</option>
            <option value={3}>3</option>
          </select>
        </label>
      )}

      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={handleRun} disabled={running || !effectiveSection}>
          {running ? `Running… ${run ? seconds(run.elapsedMs) : ""}` : "Run test"}
        </button>
        {run?.state === "running" && (
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => cancel.mutate({ id: run.id })}
            disabled={cancel.isPending}
          >
            Stop
          </button>
        )}
      </div>

      {run && run.steps.length > 0 && <StepLog steps={run.steps} running={run.state === "running"} />}
      {error && <p className={own.error}>{error}</p>}
      {run?.result && <PreviewResult result={run.result} />}
    </CardSection>
  );
}

/** What the test has done so far, each step stamped with when it began — the gap to the next is how long it took. */
function StepLog({ steps, running }: { steps: Status["steps"]; running: boolean }) {
  return (
    <ol className={own.steps} aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className={running && i === steps.length - 1 ? own.stepCurrent : own.step}>
          <span className={own.stepAt}>{seconds(s.atMs)}</span>
          <span>{s.message}</span>
        </li>
      ))}
    </ol>
  );
}

function PreviewResult({ result }: { result: Preview }) {
  const calls = result.rows.filter((r) => r.usage);
  const totals = calls.reduce(
    (acc, r) => ({
      in: acc.in + (r.usage?.tokensIn ?? 0),
      cached: acc.cached + (r.usage?.tokensInCached ?? 0),
      out: acc.out + (r.usage?.tokensOut ?? 0),
      ms: acc.ms + (r.usage?.durationMs ?? 0),
    }),
    { in: 0, cached: 0, out: 0, ms: 0 },
  );
  const reportsCache = calls.some((r) => r.usage?.tokensInCached !== null);

  return (
    <div className={own.results}>
      <p className={own.summary}>
        {result.sectionTitle}
        {result.user ? ` · ${result.user}` : " · whole server"} · {nf.format(result.libraryTitles)} titles sent as the
        library · rows need {result.minItems}+ matching titles
      </p>

      {calls.length > 0 && (
        <div className={own.callsScroll}>
          <table className={own.calls}>
            <thead>
              <tr>
                <th>Call</th>
                <th className={own.num}>Tokens in</th>
                <th className={own.num}>From cache</th>
                <th className={own.num}>Out</th>
                <th className={own.num}>Time</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((r) => (
                <tr key={r.watchedTitle}>
                  <td>{r.watchedTitle}</td>
                  <td className={own.num}>{nf.format(r.usage!.tokensIn)}</td>
                  <td className={own.num}>
                    {r.usage!.tokensInCached === null ? (
                      <span className={own.muted}>not reported</span>
                    ) : (
                      nf.format(r.usage!.tokensInCached)
                    )}
                  </td>
                  <td className={own.num}>{nf.format(r.usage!.tokensOut)}</td>
                  <td className={own.num}>{seconds(r.usage!.durationMs)}</td>
                  <td className={own.muted}>{r.usage!.model}</td>
                </tr>
              ))}
              {calls.length > 1 && (
                <tr>
                  <td>Total</td>
                  <td className={own.num}>{nf.format(totals.in)}</td>
                  <td className={own.num}>{reportsCache ? nf.format(totals.cached) : "—"}</td>
                  <td className={own.num}>{nf.format(totals.out)}</td>
                  <td className={own.num}>{seconds(totals.ms)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {result.rows.map((row) => (
        <div key={row.watchedTitle} className={own.row}>
          <p className={own.rowTitle}>{row.rowName}</p>
          <div className={own.rowMeta}>
            {row.error ? (
              <span className={own.pillWarn}>Failed</span>
            ) : row.wouldCreate ? (
              <span className={own.pillOk}>
                {row.matchedCount} of {row.items.length} titles matched — would be created
              </span>
            ) : (
              <span className={own.pillWarn}>
                Only {row.matchedCount} of {row.items.length} matched — a run would skip it
              </span>
            )}
            {row.existsAlready && (
              <span className={own.pill}>Already exists — tonight&rsquo;s run keeps it and skips this call</span>
            )}
          </div>
          {row.error && <p className={own.error}>{row.error}</p>}
          {row.response !== null && (
            <details className={own.response}>
              <summary>Model&rsquo;s answer, verbatim</summary>
              <pre className={own.responseText}>{row.response}</pre>
            </details>
          )}
          {row.items.length > 0 && (
            <div className={own.items}>
              {row.items.map((item) => (
                <span
                  key={item.title}
                  className={item.matched ? own.item : own.itemMissing}
                  title={item.matched ? undefined : "Not in the library — a real run drops it"}
                >
                  {item.title}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
