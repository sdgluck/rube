import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const GO_MAP: Record<string, string> = {
  s: "/stats",
  c: "/collections",
  j: "/jobs",
  m: "/media",
  e: "/events",
  u: "/users",
  r: "/rules",
  o: "/overlays",
  p: "/settings/plex",
};

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export default function useKeyboardShortcuts(
  setShortcutsHelpOpen: (open: boolean) => void,
  openCommandPalette: (initialQuery?: string) => void,
) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearG = useCallback(() => {
    pendingG.current = false;
    if (gTimer.current) {
      clearTimeout(gTimer.current);
      gTimer.current = undefined;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K: command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      if (isInputFocused()) return;

      // ? -> show keyboard shortcuts help
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
        return;
      }

      // / -> focus first page-level search input, else open palette
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="earch"]');
        if (input) {
          input.focus();
        } else {
          openCommandPalette();
        }
        return;
      }

      // g -> start go-to sequence
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!pendingG.current) {
          pendingG.current = true;
          gTimer.current = setTimeout(clearG, 1000);
          return;
        }
      }

      // second key in g-sequence
      if (pendingG.current) {
        const path = GO_MAP[e.key];
        if (path) {
          e.preventDefault();
          navigate(path);
        }
        clearG();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate, setShortcutsHelpOpen, openCommandPalette, clearG]);
}
