import { useState } from "react";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import EmptyState from "#components/EmptyState";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import { useUserDetail } from "./context.ts";
import local from "./UserDetail.module.css";

/**
 * Plex's own content-rating vocabulary, movies then TV. Free text would be
 * accepted by the API and then silently match nothing, which is the worst
 * possible failure for a parental control.
 */
const MOVIE_RATINGS = ["G", "PG", "PG-13", "R", "NC-17", "NR"];
const TV_RATINGS = ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"];

export default function Access() {
  const { userId, detail, refresh } = useUserDetail();
  const { addToast } = useToast();
  const { user, share, sections, personalization } = detail;

  const [pendingSections, setPendingSections] = useState<Set<number> | null>(null);

  const librariesMutation = trpc.users.updateLibraries.useMutation();
  const settingsMutation = trpc.users.updateSettings.useMutation();
  const ratingsMutation = trpc.users.updateContentRatings.useMutation();

  if (user.isOwner) {
    return (
      <EmptyState
        icon="person"
        title="This is the server owner"
        description="Plex doesn't let the account that owns a server restrict, unshare or remove itself, so there is nothing to configure here."
      />
    );
  }

  if (!share) {
    return (
      <EmptyState
        icon="person"
        title="No share on this server"
        description="This user reaches the server through Plex Home rather than a share, so there are no libraries or permissions to set."
      />
    );
  }

  const selected = pendingSections ?? new Set(share.librarySectionIds);
  const dirty = pendingSections !== null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
      addToast(label, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Plex rejected the change", "error");
    }
  };

  const toggleSection = (key: number) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPendingSections(next);
  };

  const toggleRatings = (type: "movies" | "television", rating: string) => {
    const current = type === "movies" ? share.contentRatingMovies : share.contentRatingTelevision;
    const next = current.includes(rating) ? current.filter((r) => r !== rating) : [...current, rating];
    run("Content ratings updated", () => ratingsMutation.mutateAsync({ userId, [type]: next }));
  };

  const busy = librariesMutation.isPending || settingsMutation.isPending || ratingsMutation.isPending;

  return (
    <div className={local.panels}>
      {!share.accepted && (
        <Banner variant="warn">
          This invite hasn&rsquo;t been accepted yet. The settings below are already in force and will apply the moment
          it is.
        </Banner>
      )}

      <section className={local.panel}>
        <h3 className={local.panelTitle}>Libraries</h3>
        <p className={local.panelHint}>
          {selected.size === 0
            ? "Nothing ticked shares every library — Plex's own convention, and what a new share starts as."
            : `${selected.size} of ${sections.length} shared.`}
        </p>
        <div className={shared.labelCheckboxList}>
          {sections.map((section) => (
            <label key={section.key} className={shared.labelCheckboxItem}>
              <input
                type="checkbox"
                checked={selected.has(Number(section.key))}
                disabled={busy}
                onChange={() => toggleSection(Number(section.key))}
              />
              {section.title}
            </label>
          ))}
        </div>
        {dirty && (
          <div className={local.panelActions}>
            <button type="button" className={shared.buttonSecondary} onClick={() => setPendingSections(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={shared.button}
              disabled={busy}
              onClick={() =>
                run("Libraries updated", async () => {
                  await librariesMutation.mutateAsync({ userId, librarySectionIds: [...selected] });
                  setPendingSections(null);
                })
              }
            >
              {librariesMutation.isPending ? "Saving…" : "Save libraries"}
            </button>
          </div>
        )}
      </section>

      <section className={local.panel}>
        <h3 className={local.panelTitle}>Permissions</h3>
        <div className={shared.labelCheckboxList}>
          {(
            [
              ["allowSync", "Allow downloads"],
              ["allowTuners", "Allow Live TV & DVR"],
              ["allowChannels", "Allow channels"],
              ["allowCameraUpload", "Allow camera upload"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={shared.labelCheckboxItem}>
              <input
                type="checkbox"
                checked={share[key]}
                disabled={busy}
                onChange={(e) =>
                  run("Permissions updated", () => settingsMutation.mutateAsync({ userId, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className={local.panel}>
        <h3 className={local.panelTitle}>Content ratings</h3>
        <p className={local.panelHint}>
          Nothing ticked means no rating limit. Ticking some restricts the user to exactly those.
        </p>
        {(
          [
            ["movies", "Movies", MOVIE_RATINGS, share.contentRatingMovies],
            ["television", "TV", TV_RATINGS, share.contentRatingTelevision],
          ] as const
        ).map(([type, heading, options, current]) => (
          <div key={type} className={local.ratingRow}>
            <span className={local.ratingLead}>{heading}</span>
            {options.map((rating) => (
              <label key={rating} className={local.ratingChip}>
                <input
                  type="checkbox"
                  checked={current.includes(rating)}
                  disabled={busy}
                  onChange={() => toggleRatings(type, rating)}
                />
                {rating}
              </label>
            ))}
          </div>
        ))}
      </section>

      <section className={local.panel}>
        <h3 className={local.panelTitle}>Label filters</h3>
        {personalization.ownsLabels ? (
          <Banner variant="info">
            Personalized home screens manage this user&rsquo;s label filters, so they&rsquo;re read-only here. Content
            ratings above are kept alongside them, not replaced by them. Turn the feature off under Settings &rarr;
            Personalization to edit labels directly in Plex.
          </Banner>
        ) : (
          <p className={local.panelHint}>
            No labels are in force. Turning on personalized home screens sets these to restrict each user to their own
            collections.
          </p>
        )}
        <div className={local.ratingRow}>
          <span className={local.ratingLead}>Movies</span>
          {share.labelsMovies.length === 0 ? (
            <span className={local.panelHint}>none</span>
          ) : (
            share.labelsMovies.map((l) => (
              <span key={l} className={`${shared.label} ${shared.labelTinkerbell}`}>
                {l}
              </span>
            ))
          )}
        </div>
        <div className={local.ratingRow}>
          <span className={local.ratingLead}>TV</span>
          {share.labelsTelevision.length === 0 ? (
            <span className={local.panelHint}>none</span>
          ) : (
            share.labelsTelevision.map((l) => (
              <span key={l} className={`${shared.label} ${shared.labelTinkerbell}`}>
                {l}
              </span>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
