import { GripVertical } from "lucide-react";
import type React from "react";
import styles from "./Dashboard.module.css";

export type PanelDragProps = {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  "data-drag-over"?: string;
};

export type DragHandleProps = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

/** Props every panel in a customisable dashboard grid receives. */
export type DashboardPanelProps = {
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
};

export function DragHandle({ onDragStart, onDragEnd }: DragHandleProps) {
  return (
    <span
      className={styles.panelDragHandle}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title="Drag to reorder"
      aria-label="Drag to reorder panel"
    >
      <GripVertical size={14} strokeWidth={2} />
    </span>
  );
}

export function PanelShell({
  title,
  badge,
  meta,
  actions,
  lede,
  dragHandle,
  dragProps,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  /** Right-aligned mono string: a total, a window, a last-updated time. */
  meta?: React.ReactNode;
  /** Buttons scoped to this panel, right-aligned before the drag handle. */
  actions?: React.ReactNode;
  /** One line explaining what the panel is for, above its content. */
  lede?: React.ReactNode;
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.panel} {...dragProps}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{title}</span>
        {badge}
        <span className={styles.panelSpacer} />
        {meta && <span className={styles.panelMeta}>{meta}</span>}
        {actions && <span className={styles.panelActions}>{actions}</span>}
        {dragHandle}
      </div>
      <div className={styles.panelBody}>
        {lede && <p className={styles.panelLede}>{lede}</p>}
        {children}
      </div>
    </div>
  );
}

export function PanelCountBadge({ children }: { children: React.ReactNode }) {
  return <span className={styles.countBadge}>{children}</span>;
}
