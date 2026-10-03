/**
 * Settings → Portal → Preroll: a short card Plex plays before a film, telling
 * whoever is on the sofa where to sign in and customise their home screen.
 *
 * The preview is the server's own frame (the SVG the job rasterises), not an
 * HTML mock-up of it — a mock-up would agree with itself about line breaks and
 * font sizes and disagree with the video. Whether the card is in the pool is
 * the existence of its prerolls row, so this page and the Prerolls page can't
 * contradict each other about it.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import {
  PORTAL_PREROLL_DURATION_MAX,
  PORTAL_PREROLL_DURATION_MIN,
  PORTAL_PREROLL_HEADLINE_MAX,
  PORTAL_PREROLL_MESSAGE_MAX,
  type PortalPrerollCardInput,
} from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import Banner from "#components/Banner";
import ErrorState from "#components/ErrorState";
import ToggleSwitch from "#components/ToggleSwitch";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import styles from "../Personalization.module.css";
import local from "./PortalPreroll.module.css";

/** Matches the Prerolls page: fast enough that a render feels live. */
const BUSY_POLL_MS = 1500;

const COLOUR_FIELDS = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "accent", label: "Accent" },
] as const;

const STATUS_COPY: Record<string, string> = {
  pending: "Queued for rendering…",
  processing: "Rendering…",
  ready: "In the preroll pool",
  failed: "Rendering failed",
};

export default function SettingsPortalPreroll() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const cardQuery = trpc.prerolls.portalCard.useQuery(undefined, {
    refetchInterval: (query) => {
      const status = query.state.data?.preroll?.status;
      return status === "pending" || status === "processing" ? BUSY_POLL_MS : false;
    },
  });
  const [form, setForm] = useState<PortalPrerollCardInput | null>(null);

  // Seeded once: refetches while a render is in flight must not stomp on
  // whatever the admin has typed since.
  useEffect(() => {
    if (cardQuery.data && !form) setForm(cardQuery.data.card);
  }, [cardQuery.data, form]);

  const previewInput = useDebouncedValue(form, 250);
  const previewQuery = trpc.prerolls.portalCardPreview.useQuery(previewInput ?? {}, {
    enabled: previewInput !== null,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    utils.prerolls.portalCard.invalidate();
    utils.prerolls.list.invalidate();
    utils.prerolls.plexStatus.invalidate();
  };
  const saveMutation = trpc.prerolls.savePortalCard.useMutation({ onSuccess: invalidate });
  const removeMutation = trpc.prerolls.removePortalCard.useMutation({ onSuccess: invalidate });

  if (cardQuery.error && !cardQuery.data) {
    return (
      <ErrorState
        title="Couldn't load the portal preroll"
        error={cardQuery.error}
        onRetry={() => cardQuery.refetch()}
      />
    );
  }
  if (!cardQuery.data || !form) return null;

  const { preroll, publicUrl, portalRunning } = cardQuery.data;
  const inPool = preroll !== null;
  const hasAddress = form.url.trim() !== "" || publicUrl.trim() !== "";
  const busy = saveMutation.isPending || removeMutation.isPending;

  function update<K extends keyof PortalPrerollCardInput>(key: K, value: PortalPrerollCardInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save(addToPool: boolean) {
    if (!form) return;
    try {
      const result = await saveMutation.mutateAsync({ card: form, addToPool });
      addToast(result.queued ? "Saved — rendering the preroll" : "Portal preroll saved", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't save the portal preroll", "error");
    }
  }

  async function remove() {
    try {
      const result = await removeMutation.mutateAsync();
      addToast(
        result.synced ? "Removed from your prerolls" : "Removed — sync the Prerolls page to update Plex",
        result.synced ? "success" : "error",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't remove the portal preroll", "error");
    }
  }

  return (
    <div className={styles.stack}>
      <p className={styles.lede}>
        A few seconds before a film, Plex shows your users where to sign in and make their home screen their own. It
        joins your other <Link to="/prerolls">prerolls</Link>, so it follows the same random or in-order playback.
        Prerolls need Plex Pass.
      </p>

      {!portalRunning && (
        <Banner variant="warn">
          The portal isn&apos;t running, so this address won&apos;t answer. It starts when Personalization, Cleanup
          warnings or digests are turned on.
        </Banner>
      )}

      {inPool && (
        <Banner
          variant={preroll.status === "failed" ? "error" : preroll.status === "ready" ? "ok" : "info"}
          dot
          actions={<Link to="/prerolls">Open Prerolls</Link>}
        >
          {STATUS_COPY[preroll.status] ?? preroll.status}
          {preroll.status === "ready" && preroll.enabled !== 1 && " — but switched off there"}
          {preroll.status === "failed" && preroll.error ? `: ${preroll.error}` : ""}
        </Banner>
      )}

      <div className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Address to show</span>
          <input
            className={styles.input}
            type="url"
            value={form.url}
            onChange={(e) => update("url", e.target.value)}
            placeholder={publicUrl || "https://portal.example.com"}
          />
          <span className={styles.hint}>
            Where people can reach the portal from their phone — its public address, not this admin page.
            {publicUrl ? " Leave blank to use the portal's configured public URL." : ""}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Headline</span>
          <input
            className={styles.input}
            type="text"
            value={form.headline}
            maxLength={PORTAL_PREROLL_HEADLINE_MAX}
            onChange={(e) => update("headline", e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Message</span>
          <textarea
            className={local.textarea}
            value={form.message}
            maxLength={PORTAL_PREROLL_MESSAGE_MAX}
            onChange={(e) => update("message", e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Length (seconds)</span>
          <input
            className={local.numberInput}
            type="number"
            min={PORTAL_PREROLL_DURATION_MIN}
            max={PORTAL_PREROLL_DURATION_MAX}
            value={form.durationSeconds}
            onChange={(e) => update("durationSeconds", Math.round(Number(e.target.value) || 0))}
          />
          <span className={styles.hint}>
            Long enough to point a phone at the QR code; short enough not to become the thing people skip.
          </span>
        </label>

        <div className={local.toggleRow}>
          <ToggleSwitch size="sm" checked={form.showQr} onChange={(next) => update("showQr", next)} />
          Show a QR code for the address
        </div>

        <div className={local.colours}>
          {COLOUR_FIELDS.map(({ key, label }) => (
            <div key={key} className={styles.field}>
              <span className={styles.label}>{label}</span>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  aria-label={`${label} colour`}
                />
                <input
                  className={`${styles.input} ${styles.colorInput}`}
                  type="text"
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  aria-label={`${label} colour hex value`}
                />
              </div>
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          {inPool ? (
            <>
              <button type="button" className={styles.primary} onClick={() => save(false)} disabled={busy}>
                {saveMutation.isPending ? "Saving…" : "Save and re-render"}
              </button>
              <button type="button" className={styles.danger} onClick={remove} disabled={busy}>
                Remove from prerolls
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.primary}
                onClick={() => save(true)}
                disabled={busy || !hasAddress}
                title={hasAddress ? undefined : "Enter the portal's address first"}
              >
                {saveMutation.isPending ? "Adding…" : "Add to prerolls"}
              </button>
              <button type="button" className={styles.secondary} onClick={() => save(false)} disabled={busy}>
                Save draft
              </button>
            </>
          )}
        </div>
      </div>

      <h3 className={styles.previewHeading}>Preview</h3>
      <div className={local.frame}>
        {previewQuery.data && (
          <img
            className={local.frameImg}
            src={`data:image/svg+xml;utf8,${encodeURIComponent(previewQuery.data.svg)}`}
            alt="The portal preroll as Plex will show it"
          />
        )}
      </div>
    </div>
  );
}
