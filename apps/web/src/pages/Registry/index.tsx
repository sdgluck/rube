import { useState } from "react";
import { trpc } from "#/trpc";
import PageShell from "#components/PageShell";
import ErrorState from "#components/ErrorState";
import { PageSkeleton } from "#components/Skeleton";
import useDocumentTitle from "#hooks/useDocumentTitle";
import PackDetail from "./PackDetail";
import { REQUIREMENT_LABELS } from "./labels";
import styles from "./Registry.module.css";

export default function Registry() {
  // Derives the title from NAV_SECTIONS, where /registry is registered.
  useDocumentTitle();
  const [openPack, setOpenPack] = useState<string | null>(null);

  const query = trpc.registry.index.useQuery({ force: false }, { staleTime: 10 * 60_000 });
  const utils = trpc.useUtils();

  if (query.isLoading && !query.data) return <PageSkeleton />;
  if (query.error && !query.data) {
    return (
      <PageShell>
        <ErrorState
          title="Couldn't reach the rule registry"
          error={query.error}
          onRetry={() => {
            utils.registry.index.invalidate();
          }}
        />
      </PageShell>
    );
  }

  const index = query.data!;
  const rulesBySlug = new Map(index.rules.map((r) => [r.slug, r]));

  return (
    <PageShell
      count={index.packs.length.toLocaleString()}
      actions={
        <button
          type="button"
          className={styles.refresh}
          onClick={() => {
            // `force` bypasses the server's one-hour cache; a plain invalidate
            // would just re-serve the same cached payload.
            utils.registry.index.fetch({ force: true }).then(() => utils.registry.index.invalidate());
          }}
        >
          Refresh
        </button>
      }
    >
      <p className={styles.intro}>
        Curated rule packs from{" "}
        <a href="https://tinkerbell.dev/registry" target="_blank" rel="noreferrer">
          tinkerbell.dev
        </a>
        . Importing rewrites each rule for this server and creates it disabled by default, so nothing touches Plex until
        you say so.
      </p>

      <div className={styles.grid}>
        {index.packs.map((pack) => {
          const rules = pack.ruleSlugs.flatMap((s) => {
            const rule = rulesBySlug.get(s);
            return rule ? [rule] : [];
          });
          const requirements = [...new Set(rules.flatMap((r) => r.requires))].sort();
          return (
            <button key={pack.slug} type="button" className={styles.packCard} onClick={() => setOpenPack(pack.slug)}>
              <h2>{pack.title}</h2>
              <p className={styles.tagline}>{pack.tagline}</p>
              <p className={styles.body}>{pack.description}</p>
              <div className={styles.meta}>
                <span className={styles.count}>
                  {rules.length} rule{rules.length === 1 ? "" : "s"}
                </span>
                {requirements.map((req) => (
                  <span key={req} className={styles.req}>
                    needs {REQUIREMENT_LABELS[req] ?? req}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {openPack && <PackDetail packSlug={openPack} index={index} onClose={() => setOpenPack(null)} />}
    </PageShell>
  );
}
