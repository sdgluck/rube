import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DragHandle, type PanelDragProps } from "./PanelShell";

/**
 * Drag-to-reorder for a dashboard's masonry panels.
 *
 * The saved order is the source of truth but is never trusted: unknown ids
 * (a panel we've since removed) are dropped and panels the user has never
 * seen are appended in their default position, so a stale config can't hide
 * a panel that shipped later.
 */
export function usePanelOrder<Id extends string>({
  ids,
  saved,
  onSave,
}: {
  /** Every panel id, in the order a fresh install should see them. */
  ids: readonly Id[];
  saved: string[] | undefined;
  onSave: (next: Id[]) => void;
}): {
  order: Id[];
  dragHandleFor: (index: number) => ReactNode;
  dragPropsFor: (id: Id, index: number) => PanelDragProps;
} {
  const resolved = useMemo<Id[]>(() => {
    const known = new Set<string>(ids);
    const seen = new Set<string>();
    const out: Id[] = [];
    for (const id of saved ?? []) {
      if (known.has(id) && !seen.has(id)) {
        out.push(id as Id);
        seen.add(id);
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  }, [saved?.join(","), ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [order, setOrder] = useState<Id[]>(resolved);
  useEffect(() => setOrder(resolved), [resolved]);

  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<Id | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    onSave(next);
  };

  return {
    order,
    dragHandleFor: (index) =>
      createElement(DragHandle, {
        onDragStart: (e: React.DragEvent) => {
          dragIndex.current = index;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
        },
        onDragEnd: () => {
          dragIndex.current = null;
          setDragOver(null);
        },
      }),
    dragPropsFor: (id, index) => ({
      onDragOver: (e) => {
        if (dragIndex.current == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOver !== id) setDragOver(id);
      },
      onDragLeave: () => {
        if (dragOver === id) setDragOver(null);
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragIndex.current;
        dragIndex.current = null;
        setDragOver(null);
        if (from == null) return;
        move(from, index);
      },
      "data-drag-over": dragOver === id ? "true" : undefined,
    }),
  };
}
