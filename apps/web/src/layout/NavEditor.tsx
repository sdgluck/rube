import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Smartphone } from "lucide-react";
import { MAX_BOTTOM_TABS } from "#/nav";
import type { NavMenu } from "#hooks/useNavMenu";
import styles from "./NavEditor.module.css";

/**
 * The menu, in edit mode. One component for both places it appears — the
 * sidebar on a desktop and the /more page on a phone — because they are editing
 * the same four config keys and a second implementation would be a second set
 * of rules about what can be hidden.
 *
 * `drag` is the only difference between the two, and it is off on touch for a
 * concrete reason: mobile Safari does not implement HTML5 drag-and-drop, so a
 * grip there is a control that does nothing. The ↑/↓ buttons are not a fallback
 * for that case — they are the primary way to reorder in both, because a drag
 * handle is unreachable by keyboard however good the pointer story is.
 */
export default function NavEditor({ menu, drag = false }: { menu: NavMenu; drag?: boolean }) {
  const { editableSections: sections } = menu;
  const tabCount = menu.bottomTabs.length;

  // Which row (or section) is mid-drag. A ref, not state: it is read during the
  // drop handler and must not cause a render on every dragover.
  const dragItem = useRef<{ sectionId: string; index: number } | null>(null);
  const dragSection = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Editing menu</span>
        <span className={styles.headerCount}>
          {tabCount}/{MAX_BOTTOM_TABS} tabs
        </span>
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
                <GripVertical size={13} strokeWidth={2} />
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
              <ChevronUp size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => menu.moveSection(sectionIndex, sectionIndex + 1)}
              disabled={sectionIndex === sections.length - 1}
              aria-label={`Move ${section.label} down`}
            >
              <ChevronDown size={13} strokeWidth={2} />
            </button>
          </div>

          {section.items.map((item, index) => {
            const hidden = menu.isHidden(item.to);
            const slot = menu.tabSlot(item.to);
            const canTab = !hidden && (slot > 0 || !menu.tabsFull);
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
                    <GripVertical size={13} strokeWidth={2} />
                  </span>
                )}
                <span className={styles.label}>{item.label}</span>
                {slot > 0 && <span className={styles.slot}>{slot}</span>}
                <button
                  type="button"
                  className={`${styles.toggle} ${slot > 0 ? styles.toggleOn : ""}`}
                  onClick={() => menu.toggleTab(item.to)}
                  disabled={!canTab}
                  title={
                    hidden
                      ? "A hidden page can't be a tab"
                      : slot > 0
                        ? `Remove ${item.label} from the mobile tab bar`
                        : menu.tabsFull
                          ? `The tab bar is full (${MAX_BOTTOM_TABS})`
                          : `Put ${item.label} in the mobile tab bar`
                  }
                  aria-pressed={slot > 0}
                  aria-label={`${item.label} in the mobile tab bar`}
                >
                  <Smartphone size={13} strokeWidth={2} />
                </button>
                {menu.canHide(item.to) ? (
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => menu.toggleHidden(item.to)}
                    title={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                    aria-pressed={!hidden}
                    aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                  >
                    {hidden ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
                  </button>
                ) : (
                  // Not a disabled button: there is nothing to press, and a
                  // greyed control invites a click that will never do anything.
                  <span className={styles.pinned} title="Settings is always in the menu — it's the way back">
                    <Eye size={13} strokeWidth={2} />
                  </span>
                )}
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => menu.moveItem(section.id, index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                >
                  <ChevronUp size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => menu.moveItem(section.id, index, index + 1)}
                  disabled={index === section.items.length - 1}
                  aria-label={`Move ${item.label} down`}
                >
                  <ChevronDown size={13} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
