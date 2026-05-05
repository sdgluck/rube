import { GripVertical } from "lucide-react";
import type React from "react";
import styles from "#pages/Stats/Stats.module.css";

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
  dragHandle,
  dragProps,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.panel} {...dragProps}>
      <div className={styles.panelHeader}>
        {dragHandle}
        {title}
        {badge}
      </div>
      {children}
    </div>
  );
}
