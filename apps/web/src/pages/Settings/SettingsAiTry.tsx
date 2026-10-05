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
 */
import { useMemo, useState } from "react";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import styles from "./Settings.module.css";
import own from "./SettingsAiTry.module.css";

type Preview = Awaited<ReturnType<ReturnType<typeof trpc.aiPreview.becauseYouWatched.useMutation>["mutateAsync"]>>;

const nf = new Intl.NumberFormat("en-GB");

export default function SettingsAiTry({ unsavedChanges }: { unsavedChanges: boolean }) {
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const usersQuery = trpc.users.list.useQuery(
    { limit: 200, offset: 0, sortDir: "asc" },
    { refetchOnWindowFocus: false, retry: false },
  );
  const preview = trpc.aiPreview.becauseYouWatched.useMutation();

  const sections = useMemo(
    () => (sectionsQuery.data ?? []).filter((s) => s.type === "movie" || s.type === "show"),
    [sectionsQuery.data],
  );
  const [sectionKey, setSectionKey] = useState("");
  const [plexUsername, setPlexUsername] = useState("");
  const [watchedTitle, setWatchedTitle] = useState("");
  const [count, setCount] = useState(2);
  const [result, setResult] = useState<Preview | null>(null);

  const effectiveSection = sectionKey || sections[0]?.key || "";

  async function handleRun() {
    setResult(null);
    try {
      setResult(
        await preview.mutateAsync({
          sectionKey: effectiveSection,
          plexUsername: plexUsername || undefined,
          watchedTitle: watchedTitle.trim() || undefined,
          count: watchedTitle.trim() ? 1 : count,
        }),
      );
    } catch {
      // Shown from the mutation's error below.
    }
  }

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
        <button
          type="button"
          className={styles.button}
          onClick={handleRun}
          disabled={preview.isPending || !effectiveSection}
        >
          {preview.isPending ? "Running…" : "Run test"}
        </button>
      </div>

      {preview.error && <p className={own.error}>{preview.error.message}</p>}
      {result && <PreviewResult result={result} />}
    </CardSection>
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
