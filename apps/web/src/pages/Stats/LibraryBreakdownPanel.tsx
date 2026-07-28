import type React from "react";
import { trpc } from "#/trpc";
import { DistributionBar, RESOLUTION_COLORS } from "./DistributionBar";
import styles from "#pages/Stats/Stats.module.css";
import { formatCodec, formatResolution } from "#/format";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function LibraryBreakdownPanel({
  dragHandle,
  dragProps,
}: {
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
}) {
  const overviewQuery = trpc.stats.overview.useQuery();
  if (!overviewQuery.data || overviewQuery.data.totalItems === 0) return null;

  return (
    <PanelShell title="Library Breakdown" dragHandle={dragHandle} dragProps={dragProps}>
      <div className={styles.distRows}>
        <DistributionBar
          label="Resolution"
          items={overviewQuery.data.resolutions}
          colorMap={RESOLUTION_COLORS}
          formatLabel={formatResolution}
        />
        <DistributionBar label="Video Codec" items={overviewQuery.data.videoCodecs} formatLabel={formatCodec} />
        <DistributionBar label="Audio Codec" items={overviewQuery.data.audioCodecs} formatLabel={formatCodec} />
      </div>
    </PanelShell>
  );
}
