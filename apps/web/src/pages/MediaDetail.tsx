import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { PageCrumbs } from "#layout/AppBar";
import { trpc } from "#/trpc";
import { DetailSkeleton } from "#components/Skeleton";
import FadeImage from "#components/FadeImage";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "#/styles/shared.module.css";
import {
  EMPTY,
  formatBitrate,
  formatChannels,
  formatCodec,
  formatFileSize,
  formatRuntime,
  formatSamplingRate,
} from "#/format";
import mediaStyles from "./MediaDetail.module.css";
import MediaEditPanel from "./MediaEditPanel";

function fileName(path: string | undefined): string {
  if (!path) return EMPTY;
  const parts = path.split("/");
  return parts[parts.length - 1];
}

function ratingTier(pct: number): "High" | "Mid" | "Low" {
  if (pct >= 75) return "High";
  if (pct >= 50) return "Mid";
  return "Low";
}

export default function MediaDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const [editOpen, setEditOpen] = useState(false);

  const detailQuery = trpc.media.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );
  const watchedByQuery = trpc.stats.watchedBy.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );
  const watchers = watchedByQuery.data ?? [];
  const whyQuery = trpc.media.why.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );
  const why = whyQuery.data ?? [];
  const identityQuery = trpc.plexIdentity.useQuery(undefined, { staleTime: Infinity, retry: false });

  if (detailQuery.isLoading) return <DetailSkeleton />;
  if (detailQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load media item</div>;

  const item = detailQuery.data;
  if (!item) return null;

  const machineIdentifier = identityQuery.data?.machineIdentifier;
  // Distinct rules, so an item in four collections from one rule offers one
  // "edit the rule" rather than four identical buttons.
  const owningRules = [...new Map(why.filter((w) => w.rule).map((w) => [w.rule!.id, w.rule!])).values()];

  return (
    <div ref={swipeRef}>
      <PageCrumbs crumbs={[{ label: item.title }]} onBackToParent={() => navigate(-1)} />

      <div className={styles.detailLayout}>
        <div className={styles.detailPoster}>
          {item.thumb ? (
            <FadeImage
              className={styles.detailPosterImg}
              src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
              alt={item.title}
            />
          ) : (
            <div className={styles.detailPosterPlaceholder}>No poster</div>
          )}
        </div>

        <div className={styles.detailMain}>
          {/* The page was a read-only dead end: everything you could want to
              do with the item you had just looked up happened somewhere else.
              These are the two that don't need a page of their own. */}
          <div className={mediaStyles.actions}>
            {machineIdentifier && (
              <a
                className={mediaStyles.actionBtn}
                href={`https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${encodeURIComponent(
                  `/library/metadata/${ratingKey}`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Plex
              </a>
            )}
            {/* The rule that put this item where it is, when exactly one rule
                did. With several, the Collections list below names each. */}
            {owningRules.length === 1 && (
              <Link className={mediaStyles.actionBtn} to={`/rules?q=${encodeURIComponent(owningRules[0]!.name)}`}>
                Edit the rule behind this
              </Link>
            )}
            <button className={mediaStyles.actionBtn} onClick={() => setEditOpen((v) => !v)}>
              {editOpen ? "Close metadata editor" : "Edit metadata"}
            </button>
          </div>

          <div className={mediaStyles.metaLine}>
            {[
              item.year && String(item.year),
              item.contentRating,
              item.duration && formatRuntime(item.duration),
              item.studio,
              item.type && item.type[0].toUpperCase() + item.type.slice(1),
              item.addedAt && `Added ${new Date(item.addedAt * 1000).toLocaleDateString()}`,
            ]
              .filter(Boolean)
              .map((v, i, arr) => (
                <span key={i}>
                  {v}
                  {i < arr.length - 1 && <span className={mediaStyles.metaDot}>·</span>}
                </span>
              ))}
          </div>

          {(item.rating != null || item.audienceRating != null || item.genres.length > 0) && (
            <div className={mediaStyles.tagRow}>
              {item.rating != null && (
                <span className={`${mediaStyles.ratingBadge} ${mediaStyles[`rating${ratingTier(item.rating * 10)}`]}`}>
                  <span className={mediaStyles.ratingLabel}>Critics</span>
                  <span className={mediaStyles.ratingValue}>{Math.round(item.rating * 10)}%</span>
                </span>
              )}
              {item.audienceRating != null && (
                <span
                  className={`${mediaStyles.ratingBadge} ${mediaStyles[`rating${ratingTier(item.audienceRating * 10)}`]}`}
                >
                  <span className={mediaStyles.ratingLabel}>Audience</span>
                  <span className={mediaStyles.ratingValue}>{Math.round(item.audienceRating * 10)}%</span>
                </span>
              )}
              {item.genres.map((g) => (
                <span key={g} className={mediaStyles.genreBadge}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {item.summary && <p className={mediaStyles.summary}>{item.summary}</p>}

          {/* Opened from the action bar above, but rendered here — the fields
              it edits are the ones this page already shows, so the editor sits
              next to the thing it changes rather than in a modal over it. */}
          {editOpen && <MediaEditPanel ratingKey={item.ratingKey} onClose={() => setEditOpen(false)} />}

          {/* Media Files */}
          {item.media.length > 0 && (
            <section className={mediaStyles.section}>
              <h3 className={mediaStyles.sectionTitle}>
                Media
                {item.media.length > 1 && (
                  <span className={mediaStyles.sectionCount}>{item.media.length} versions</span>
                )}
              </h3>
              {item.media.map((media, mi) => {
                const part = media.parts[0];
                const videoStreams = part?.streams.filter((s) => s.streamType === 1) || [];
                const audioStreams = part?.streams.filter((s) => s.streamType === 2) || [];
                const subtitleStreams = part?.streams.filter((s) => s.streamType === 3) || [];

                return (
                  <div key={mi} className={mediaStyles.mediaVersion}>
                    {/* File overview row */}
                    <div className={mediaStyles.fileRow}>
                      <span className={mediaStyles.fileName} title={part?.file}>
                        {fileName(part?.file)}
                      </span>
                      <div className={mediaStyles.fileMeta}>
                        {part?.size && <span>{formatFileSize(part.size)}</span>}
                        {media.container && <span>{media.container.toUpperCase()}</span>}
                        {media.bitrate && <span>{formatBitrate(media.bitrate)}</span>}
                        {media.optimizedForStreaming && <span className={mediaStyles.optimizedBadge}>Optimized</span>}
                      </div>
                    </div>

                    {/* Video streams */}
                    {videoStreams.map((vs, vi) => (
                      <div key={`v${vi}`} className={mediaStyles.streamRow}>
                        <span className={`${mediaStyles.streamLabel} ${mediaStyles.streamLabelVideo}`}>Video</span>
                        <div className={mediaStyles.streamInfo}>
                          <span className={mediaStyles.streamTitle}>{vs.displayTitle || formatCodec(vs.codec)}</span>
                          <div className={mediaStyles.streamTags}>
                            {vs.width && vs.height && (
                              <span>
                                {vs.width}x{vs.height}
                              </span>
                            )}
                            {!vs.displayTitle && vs.codec && <span>{formatCodec(vs.codec)}</span>}
                            {vs.profile && <span>{vs.profile}</span>}
                            {vs.bitrate && <span>{formatBitrate(vs.bitrate)}</span>}
                            {vs.frameRate && <span>{vs.frameRate} fps</span>}
                            {vs.bitDepth && <span>{vs.bitDepth}-bit</span>}
                            {vs.chromaSubsampling && <span>{vs.chromaSubsampling}</span>}
                            {vs.colorSpace && <span>{vs.colorSpace}</span>}
                            {vs.colorRange && <span>{vs.colorRange}</span>}
                            {vs.scanType && <span>{vs.scanType}</span>}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Audio streams */}
                    {audioStreams.map((as_, ai) => (
                      <div key={`a${ai}`} className={mediaStyles.streamRow}>
                        <span className={`${mediaStyles.streamLabel} ${mediaStyles.streamLabelAudio}`}>Audio</span>
                        <div className={mediaStyles.streamInfo}>
                          <span className={mediaStyles.streamTitle}>{as_.displayTitle || formatCodec(as_.codec)}</span>
                          <div className={mediaStyles.streamTags}>
                            {!as_.displayTitle && as_.codec && <span>{formatCodec(as_.codec)}</span>}
                            {as_.channels && <span>{formatChannels(as_.channels)}</span>}
                            {as_.audioChannelLayout && <span>{as_.audioChannelLayout}</span>}
                            {as_.bitrate && <span>{formatBitrate(as_.bitrate)}</span>}
                            {as_.samplingRate && <span>{formatSamplingRate(as_.samplingRate)}</span>}
                            {as_.language && <span>{as_.language}</span>}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Subtitle streams */}
                    {subtitleStreams.length > 0 && (
                      <div className={mediaStyles.streamRow}>
                        <span className={`${mediaStyles.streamLabel} ${mediaStyles.streamLabelSub}`}>Subtitles</span>
                        <div className={mediaStyles.streamInfo}>
                          <div className={mediaStyles.subtitleList}>
                            {subtitleStreams.map((ss, si) => (
                              <span key={si} className={mediaStyles.subtitleItem}>
                                {ss.displayTitle || ss.language || formatCodec(ss.codec)}
                                {ss.codec && <span className={mediaStyles.subtitleCodec}>{formatCodec(ss.codec)}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* Watched by — the quickest way to confirm playback tracking works */}
          {watchers.length > 0 && (
            <section className={mediaStyles.section}>
              <h3 className={mediaStyles.sectionTitle}>
                Watched by
                <span className={mediaStyles.sectionCount}>{watchers.length}</span>
              </h3>
              <ul className={mediaStyles.collectionList}>
                {watchers.map((w) => (
                  <li key={w.userId} className={mediaStyles.collectionItem}>
                    <span>{w.username}</span>
                    <span className={mediaStyles.collectionSection}>
                      {w.plays} play{w.plays === 1 ? "" : "s"}
                      {w.completedPlays > 0 ? ` · ${w.completedPlays} finished` : ""}
                      {w.lastPlayedAt ? ` · last ${new Date(w.lastPlayedAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Collections — and, for each, why this item is in it */}
          {item.collections.length > 0 && (
            <section className={mediaStyles.section}>
              <h3 className={mediaStyles.sectionTitle}>
                Collections
                <span className={mediaStyles.sectionCount}>{item.collections.length}</span>
              </h3>
              <ul className={mediaStyles.collectionList}>
                {item.collections.map((col) => {
                  const reason = why.find((w) => w.collection.ratingKey === col.ratingKey);
                  return (
                    <li key={col.ratingKey} className={mediaStyles.collectionItem}>
                      <div className={mediaStyles.collectionMain}>
                        <Link to={`/collections/${col.ratingKey}`} className={mediaStyles.collectionLink}>
                          {col.title}
                        </Link>
                        {/* The answer to "why is this here" — the rule behind
                            the collection, and what that rule asks for. A
                            collection nobody automated says so, because "made
                            by hand in Plex" is a real answer. */}
                        {reason?.rule ? (
                          <span className={mediaStyles.collectionReason}>
                            from <Link to={`/rules?q=${encodeURIComponent(reason.rule.name)}`}>{reason.rule.name}</Link>
                            {reason.criteria && (
                              <span className={mediaStyles.collectionCriteria}>{reason.criteria}</span>
                            )}
                          </span>
                        ) : (
                          whyQuery.isSuccess && (
                            <span className={mediaStyles.collectionReason}>not built by a rule</span>
                          )
                        )}
                      </div>
                      {col.sectionTitle && <span className={mediaStyles.collectionSection}>{col.sectionTitle}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
