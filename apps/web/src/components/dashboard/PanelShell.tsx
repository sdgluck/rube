import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type React from "react";
import { createContext, useContext } from "react";
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

/**
 * The collapse toggle for the panel currently being rendered.
 *
 * Passed by context rather than as a prop because the control belongs in the
 * panel *header*, which `PanelShell` owns, while the state belongs to the page
 * that persists it — and threading a pair of props through every panel
 * component on two dashboards would make "this panel can be collapsed" a thing
 * each panel has to opt into and remember to forward. Absent (null) means the
 * panel isn't in a collapsible context, and no chevron is drawn.
 */
const PanelCollapseContext = createContext<(() => void) | null>(null);

export function PanelCollapseProvider({ onToggle, children }: { onToggle: () => void; children: React.ReactNode }) {
  return <PanelCollapseContext.Provider value={onToggle}>{children}</PanelCollapseContext.Provider>;
}

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

/** The title, as a button when the panel can be rolled up and as plain text when it can't. */
function PanelTitle({ title, onToggle }: { title: string; onToggle: (() => void) | null }) {
  if (!onToggle) return <span className={styles.panelTitle}>{title}</span>;
  return (
    <button
      type="button"
      className={`${styles.panelTitle} ${styles.panelTitleToggle}`}
      onClick={onToggle}
      aria-expanded={true}
      title="Collapse panel"
    >
      <ChevronDown size={13} strokeWidth={2.5} className={styles.panelChevron} aria-hidden />
      {title}
    </button>
  );
}

export function PanelShell({
  title,
  badge,
  meta,
  actions,
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
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
  children: React.ReactNode;
}) {
  const onToggle = useContext(PanelCollapseContext);
  return (
    <div className={styles.panel} {...dragProps}>
      <div className={styles.panelHeader}>
        <PanelTitle title={title} onToggle={onToggle} />
        {badge}
        <span className={styles.panelSpacer} />
        {meta && <span className={styles.panelMeta}>{meta}</span>}
        {actions && <span className={styles.panelActions}>{actions}</span>}
        {dragHandle}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </div>
  );
}

/**
 * A rolled-up panel: its header, and nothing else.
 *
 * Rendered *instead of* the panel component rather than around it, which is why
 * this takes a title rather than reading one from the panel it replaces. A
 * collapsed panel is one the user has said they aren't looking at, so mounting
 * it to hide its body would leave its queries running — and several of these
 * poll. Collapsing the Streams panel should stop asking Plex what's playing
 * every five seconds, not merely stop showing the answer.
 */
export function CollapsedPanel({
  title,
  onToggle,
  dragHandle,
  dragProps,
}: {
  title: string;
  onToggle: () => void;
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
}) {
  return (
    <div className={`${styles.panel} ${styles.panelCollapsed}`} {...dragProps}>
      <div className={styles.panelHeader}>
        <button
          type="button"
          className={`${styles.panelTitle} ${styles.panelTitleToggle}`}
          onClick={onToggle}
          aria-expanded={false}
          title="Expand panel"
        >
          <ChevronRight size={13} strokeWidth={2.5} className={styles.panelChevron} aria-hidden />
          {title}
        </button>
        <span className={styles.panelSpacer} />
        {dragHandle}
      </div>
    </div>
  );
}

export function PanelCountBadge({ children }: { children: React.ReactNode }) {
  return <span className={styles.countBadge}>{children}</span>;
}
