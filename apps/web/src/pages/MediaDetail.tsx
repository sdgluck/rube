import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { DetailSkeleton } from "#components/Skeleton";
import FadeImage from "#components/FadeImage";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "#/styles/shared.module.css";
import mediaStyles from "./MediaDetail.module.css";

function formatCodec(codec: string | undefined): string {
  if (!codec) return "—";
  const map: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    h265: "HEVC",
    vp9: "VP9",
    av1: "AV1",
    mpeg4: "MPEG-4",
    vc1: "VC-1",
    mpeg2video: "MPEG-2",
    aac: "AAC",
    ac3: "AC3",
    eac3: "EAC3",
    dca: "DTS",
    "dca-ma": "DTS-HD MA",
    truehd: "TrueHD",
    flac: "FLAC",
    mp3: "MP3",
    opus: "Opus",
    vorbis: "Vorbis",
    pcm: "PCM",
    pcm_s16le: "PCM",
    pcm_s24le: "PCM 24-bit",
    subrip: "SRT",
    srt: "SRT",
    ass: "ASS",
    ssa: "SSA",
    mov_text: "TX3G",
    pgssub: "PGS",
    dvd_subtitle: "VobSub",
    hdmv_pgs_subtitle: "PGS",
    webvtt: "WebVTT",
  };
  return map[codec.toLowerCase()] || codec.toUpperCase();
}

function formatChannels(ch: number | undefined): string {
  if (!ch) return "";
  if (ch === 8) return "7.1";
  if (ch === 6) return "5.1";
  if (ch === 2) return "Stereo";
  if (ch === 1) return "Mono";
  return `${ch}ch`;
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatBitrate(kbps: number | undefined): string {
  if (!kbps) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatSamplingRate(rate: number | undefined): string {
  if (!rate) return "";
  return `${(rate / 1000).toFixed(1)} kHz`;
}

function fileName(path: string | undefined): string {
  if (!path) return "—";
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

  const detailQuery = trpc.media.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  if (detailQuery.isLoading) return <DetailSkeleton />;
  if (detailQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load media item</div>;

  const item = detailQuery.data;
  if (!item) return null;

  return (
    <div ref={swipeRef}>
      <a
        href="#"
        className={styles.backLink}
        onClick={(e) => {
          e.preventDefault();
          navigate(-1);
        }}
      >
        &larr; Back to Media
      </a>

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
          <h2 className={`${styles.heading} ${mediaStyles.title}`}>{item.title}</h2>

          <div className={mediaStyles.metaLine}>
            {[
              item.year && String(item.year),
              item.contentRating,
              item.duration && formatDuration(item.duration),
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

          {/* Collections */}
          {item.collections.length > 0 && (
            <section className={mediaStyles.section}>
              <h3 className={mediaStyles.sectionTitle}>
                Collections
                <span className={mediaStyles.sectionCount}>{item.collections.length}</span>
              </h3>
              <ul className={mediaStyles.collectionList}>
                {item.collections.map((col) => (
                  <li key={col.ratingKey} className={mediaStyles.collectionItem}>
                    <Link to={`/collections/${col.ratingKey}`} className={mediaStyles.collectionLink}>
                      {col.title}
                    </Link>
                    {col.sectionTitle && <span className={mediaStyles.collectionSection}>{col.sectionTitle}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
