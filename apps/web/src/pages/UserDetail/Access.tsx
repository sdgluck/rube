import { useState } from "react";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import AllOption from "#components/AllOption";
import SettingsPageLink from "#components/SettingsPageLink";
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

  // The layout hides this tab for the owner and for Home users, and redirects
  // a deep link away — this only narrows the types.
  if (user.isOwner || !share) return null;

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

  // Read-only either way; dimmed when Personalization owns them, so they read
  // as set elsewhere rather than as something to click.
  const locked = personalization.ownsLabels ? local.labelLocked : "";

  const busy = librariesMutation.isPending || settingsMutation.isPending || ratingsMutation.isPending;

  return (
    <div className={local.panels}>
      {!share.accepted && <Banner variant="warn">Invite not accepted yet — these apply the moment it is.</Banner>}

      <section className={local.panel}>
        <h3 className={local.panelTitle}>Libraries</h3>
        <div className={shared.labelCheckboxList}>
          <AllOption
            label="All libraries"
            checked={selected.size === 0}
            disabled={busy}
            onSelect={() => setPendingSections(new Set())}
            className={shared.labelCheckboxItem}
          />
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
        {(
          [
            ["movies", "Movies", MOVIE_RATINGS, share.contentRatingMovies],
            ["television", "TV", TV_RATINGS, share.contentRatingTelevision],
          ] as const
        ).map(([type, heading, options, current]) => (
          <div key={type} className={local.ratingRow}>
            <span className={local.ratingLead}>{heading}</span>
            <AllOption
              label="No limit"
              checked={current.length === 0}
              disabled={busy}
              onSelect={() => run("Content ratings updated", () => ratingsMutation.mutateAsync({ userId, [type]: [] }))}
              className={local.ratingChip}
            />
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
        {personalization.ownsLabels && (
          <p className={local.panelHint}>
            <SettingsPageLink to="/settings/portal/personalization">Managed by Personalization</SettingsPageLink>
          </p>
        )}
        <div className={local.ratingRow}>
          <span className={local.ratingLead}>Movies</span>
          {share.labelsMovies.length === 0 ? (
            <span className={local.panelHint}>none</span>
          ) : (
            share.labelsMovies.map((l) => (
              <span key={l} className={`${shared.label} ${shared.labelTinkerbell} ${locked}`}>
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
              <span key={l} className={`${shared.label} ${shared.labelTinkerbell} ${locked}`}>
                {l}
              </span>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
