import { useEffect, useRef, useState } from "react";
import { badgeScale, calculatePosition, loadBadgeFont, renderBadgeSvg } from "./badgeRender.ts";
import type { BadgeStyle, OverlayPosition, OverlayType } from "@rube/contracts";

export interface CanvasBadge {
  /** Optional config id — emitted back via onLayout so callers can match hit boxes to configs. */
  id?: number;
  position: OverlayPosition;
  type: OverlayType;
  value: string;
  style?: BadgeStyle | null;
  order?: number;
}

export interface BadgeLayout {
  id?: number;
  position: OverlayPosition;
  /** All values are in image-natural pixels (the canvas drawing coordinate system). */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  posterUrl: string | null;
  badges: CanvasBadge[];
  /** When true, render the bare poster (no badges). */
  hideBadges?: boolean;
  className?: string;
  alt?: string;
  /**
   * Called whenever the canvas finishes rendering, with each drawn badge's box
   * in image-natural pixel coordinates and the canvas's natural dimensions.
   * Callers can scale by (displayWidth / naturalWidth) to position DOM hit
   * targets that line up exactly with the painted badges.
   */
  onLayout?: (layout: BadgeLayout[], naturalWidth: number, naturalHeight: number) => void;
}

const STACK_GAP = 6;
const posterCache = new Map<string, HTMLImageElement>();

function loadPoster(url: string): Promise<HTMLImageElement> {
  const cached = posterCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      posterCache.set(url, img);
      resolve(img);
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export function PosterCanvas({ posterUrl, badges, hideBadges, className, alt, onLayout }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const renderToken = useRef(0);

  useEffect(() => {
    if (!posterUrl) return;
    const myToken = ++renderToken.current;
    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const [poster, font] = await Promise.all([loadPoster(posterUrl), loadBadgeFont()]);
        if (cancelled || myToken !== renderToken.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const imgW = poster.naturalWidth;
        const imgH = poster.naturalHeight;
        canvas.width = imgW;
        canvas.height = imgH;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, imgW, imgH);
        ctx.drawImage(poster, 0, 0);

        if (hideBadges || badges.length === 0) {
          if (!cancelled) {
            setLoading(false);
            onLayout?.([], imgW, imgH);
          }
          return;
        }

        const scale = badgeScale(imgW);

        // Group by position, sorted by order, for stacking.
        const groups = new Map<OverlayPosition, CanvasBadge[]>();
        for (const b of badges) {
          const list = groups.get(b.position) ?? [];
          list.push(b);
          groups.set(b.position, list);
        }
        for (const list of groups.values()) {
          list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        }

        const gap = Math.round(STACK_GAP * scale);
        const emittedLayout: BadgeLayout[] = [];

        for (const [position, list] of groups) {
          let stackOffset = 0;
          for (const badge of list) {
            const rendered = renderBadgeSvg(font, badge.type, badge.value, scale, badge.style);
            const badgeImg = await svgToImage(rendered.svg);
            if (cancelled || myToken !== renderToken.current) return;

            const pos = calculatePosition(position, imgW, imgH, rendered.width, rendered.height, scale);
            const isBottom = position.startsWith("bottom");
            const top = isBottom ? pos.top - stackOffset : pos.top + stackOffset;

            const drawLeft = Math.max(0, pos.left);
            const drawTop = Math.max(0, top);
            ctx.drawImage(badgeImg, drawLeft, drawTop);
            emittedLayout.push({
              id: badge.id,
              position,
              left: drawLeft,
              top: drawTop,
              width: rendered.width,
              height: rendered.height,
            });
            stackOffset += rendered.height + gap;
          }
        }

        if (!cancelled) {
          setLoading(false);
          onLayout?.(emittedLayout, imgW, imgH);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    posterUrl,
    hideBadges,
    JSON.stringify(badges.map((b) => ({ p: b.position, t: b.type, v: b.value, o: b.order, s: b.style }))),
  ]);

  if (!posterUrl) return null;
  return (
    <>
      <canvas ref={canvasRef} className={className} aria-label={alt} role="img" />
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: "0.8rem",
            left: "0.8rem",
            color: "var(--status-error-fg)",
            fontSize: "1.1rem",
          }}
        >
          {error}
        </div>
      )}
      {loading && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
    </>
  );
}
