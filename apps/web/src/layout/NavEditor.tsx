import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical } from "lucide-react";
import type { NavMenu } from "#hooks/useNavMenu";
import styles from "./NavEditor.module.css";

/**
 * The menu, in edit mode, inside the sidebar (or the drawer it becomes on a
 * phone).
 *
 * `drag` adds grips for HTML5 drag-and-drop. The ↑/↓ buttons are not a
 * fallback for touch screens, where mobile Safari has no drag-and-drop — they
 * are the primary way to reorder everywhere, because a drag handle is
 * unreachable by keyboard however good the pointer story is.
 */
export default function NavEditor({ menu, drag = false }: { menu: NavMenu; drag?: boolean }) {
  const { editableSections: sections } = menu;

  // Which row (or section) is mid-drag. A ref, not state: it is read during the
  // drop handler and must not cause a render on every dragover.
  const dragItem = useRef<{ sectionId: string; index: number } | null>(null);
  const dragSection = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Editing menu</span>
        <button
          type="button"
          className={styles.headerButton}
          onClick={menu.reset}
          disabled={menu.isDefault}
          title="Put every item back where it started"
        >
          Reset
        </button>
        <button type="button" className={styles.headerDone} onClick={() => menu.setEditing(false)}>
          Done
        </button>
      </div>

      {sections.map((section, sectionIndex) => (
        <div
          key={section.id}
          className={`${styles.section} ${dropTarget === `section:${section.id}` ? styles.dropTarget : ""}`}
          onDragOver={
            drag
              ? (e) => {
                  if (dragSection.current == null) return;
                  e.preventDefault();
                  setDropTarget(`section:${section.id}`);
                }
              : undefined
          }
          onDragLeave={drag ? () => setDropTarget(null) : undefined}
          onDrop={
            drag
              ? (e) => {
                  e.preventDefault();
                  const from = dragSection.current;
                  dragSection.current = null;
                  setDropTarget(null);
                  if (from != null) menu.moveSection(from, sectionIndex);
                }
              : undefined
          }
        >
          <div className={styles.sectionHead}>
            {drag && (
              <span
                className={styles.grip}
                draggable
                onDragStart={(e) => {
                  dragSection.current = sectionIndex;
                  e.dataTransfer.effectAllowed = "move";
                  // Tagged so an item dropped on a section head, or a section
                  // dropped on a row, is refused rather than half-applied.
                  e.dataTransfer.setData("text/plain", `nav-section:${section.id}`);
                }}
                onDragEnd={() => {
                  dragSection.current = null;
                  setDropTarget(null);
                }}
                aria-hidden="true"
              >
                <GripVertical size="1.3rem" strokeWidth={2} />
              </span>
            )}
            <span className={styles.sectionTitle}>{section.label}</span>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => menu.moveSection(sectionIndex, sectionIndex - 1)}
              disabled={sectionIndex === 0}
              aria-label={`Move ${section.label} up`}
            >
              <ChevronUp size="1.3rem" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => menu.moveSection(sectionIndex, sectionIndex + 1)}
              disabled={sectionIndex === sections.length - 1}
              aria-label={`Move ${section.label} down`}
            >
              <ChevronDown size="1.3rem" strokeWidth={2} />
            </button>
          </div>

          {section.items.map((item, index) => {
            const hidden = menu.isHidden(item.to);
            return (
              <div
                key={item.to}
                className={`${styles.row} ${hidden ? styles.rowHidden : ""} ${
                  dropTarget === `item:${item.to}` ? styles.dropTarget : ""
                }`}
                onDragOver={
                  drag
                    ? (e) => {
                        const from = dragItem.current;
                        if (!from || from.sectionId !== section.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTarget(`item:${item.to}`);
                      }
                    : undefined
                }
                onDragLeave={drag ? () => setDropTarget(null) : undefined}
                onDrop={
                  drag
                    ? (e) => {
                        e.preventDefault();
                        const from = dragItem.current;
                        dragItem.current = null;
                        setDropTarget(null);
                        if (from && from.sectionId === section.id) menu.moveItem(section.id, from.index, index);
                      }
                    : undefined
                }
              >
                {drag && (
                  <span
                    className={styles.grip}
                    draggable
                    onDragStart={(e) => {
                      dragItem.current = { sectionId: section.id, index };
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", `nav-item:${section.id}`);
                    }}
                    onDragEnd={() => {
                      dragItem.current = null;
                      setDropTarget(null);
                    }}
                    aria-hidden="true"
                  >
                    <GripVertical size="1.3rem" strokeWidth={2} />
                  </span>
                )}
                <span className={styles.label}>{item.label}</span>
                {menu.canHide(item.to) ? (
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => menu.toggleHidden(item.to)}
                    title={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                    aria-pressed={!hidden}
                    aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                  >
                    {hidden ? <EyeOff size="1.3rem" strokeWidth={2} /> : <Eye size="1.3rem" strokeWidth={2} />}
                  </button>
                ) : (
                  // Not a disabled button: there is nothing to press, and a
                  // greyed control invites a click that will never do anything.
                  <span className={styles.pinned} title="Settings is always in the menu — it's the way back">
                    <Eye size="1.3rem" strokeWidth={2} />
                  </span>
                )}
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => menu.moveItem(section.id, index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                >
                  <ChevronUp size="1.3rem" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => menu.moveItem(section.id, index, index + 1)}
                  disabled={index === section.items.length - 1}
                  aria-label={`Move ${item.label} down`}
                >
                  <ChevronDown size="1.3rem" strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
