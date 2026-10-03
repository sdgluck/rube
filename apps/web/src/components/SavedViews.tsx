import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "./Toast";
import Modal from "./Modal";
import styles from "./SavedViews.module.css";
import shared from "#/styles/shared.module.css";

type ViewPage = "media" | "collections" | "rules" | "events" | "users";

interface SavedViewsProps {
  page: ViewPage;
  /**
   * Extra actions offered alongside the saved views — "Create rule from this
   * view" on Media, say. Rendered inside the same menu because they are the
   * same thought: this set of filters, and what to do with it.
   */
  extraActions?: Array<{ label: string; onSelect: () => void; disabled?: boolean; title?: string }>;
}

/**
 * Named list views: the search, filters and sort of a page, under a name.
 *
 * The whole of a view is the URL's query string, because `useListParams`
 * already keeps every list page's state there. So saving is a copy and
 * applying is a navigation — which also means a view is shareable as a plain
 * link whether or not anyone saved it.
 */
export default function SavedViews({ page, extraActions }: SavedViewsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  const viewsQuery = trpc.views.list.useQuery({ page });
  const saveMutation = trpc.views.save.useMutation();
  const deleteMutation = trpc.views.delete.useMutation();

  const currentQuery = location.search.replace(/^\?/, "");
  const views = viewsQuery.data ?? [];
  // A view is "current" when the page is showing exactly it — the comparison
  // is on the whole query string, so a changed sort counts as a different view.
  const activeView = views.find((v) => v.query === currentQuery);

  const apply = (query: string) => {
    navigate({ pathname: location.pathname, search: query ? `?${query}` : "" });
    setOpen(false);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveMutation.mutate(
      { page, name: trimmed, query: currentQuery },
      {
        onSuccess: () => {
          utils.views.list.invalidate({ page });
          setSaveOpen(false);
          setName("");
          addToast(`Saved "${trimmed}".`, "success");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  };

  const remove = (id: string, viewName: string) => {
    deleteMutation.mutate(
      { page, id },
      {
        onSuccess: () => {
          utils.views.list.invalidate({ page });
          addToast(`Deleted "${viewName}".`, "success");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  };

  return (
    <>
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
        >
          {activeView ? activeView.name : "Views"}
          {views.length > 0 && !activeView && <span className={styles.count}>{views.length}</span>}
        </button>

        {open && (
          <>
            {/* Click-away, rather than a document listener that has to be
                careful not to fire on the trigger that opened the menu. */}
            <button type="button" className={styles.backdrop} aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className={styles.menu} role="menu">
              {views.length === 0 ? (
                <p className={styles.empty}>No saved views yet.</p>
              ) : (
                <ul className={styles.list}>
                  {views.map((view) => (
                    <li key={view.id} className={styles.item}>
                      <button
                        type="button"
                        className={styles.itemName}
                        onClick={() => apply(view.query)}
                        role="menuitem"
                      >
                        {view.name}
                      </button>
                      <button
                        type="button"
                        className={styles.itemDelete}
                        onClick={() => remove(view.id, view.name)}
                        aria-label={`Delete view "${view.name}"`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setName(activeView?.name ?? "");
                    setSaveOpen(true);
                    setOpen(false);
                  }}
                  role="menuitem"
                >
                  Save this view…
                </button>
                {currentQuery && (
                  <button type="button" className={styles.action} onClick={() => apply("")} role="menuitem">
                    Clear all filters
                  </button>
                )}
                {extraActions?.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={styles.action}
                    title={action.title}
                    disabled={action.disabled}
                    onClick={() => {
                      action.onSelect();
                      setOpen(false);
                    }}
                    role="menuitem"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {saveOpen && (
        <Modal open onClose={() => setSaveOpen(false)} title="Save this view" size="sm">
          <div className={styles.saveForm}>
            <label htmlFor="view-name">Name</label>
            <input
              id="view-name"
              className={shared.input}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              placeholder="Unwatched 4K"
            />
            <p className={styles.saveHint}>Saves the current search, filters and sort.</p>
            <div className={styles.saveActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button type="button" className={styles.saveBtn} onClick={save} disabled={!name.trim()}>
                {views.some((v) => v.name === name.trim()) ? "Replace" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
