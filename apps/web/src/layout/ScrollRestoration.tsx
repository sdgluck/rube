import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { PHONE_QUERY } from "#hooks/useMediaQuery";

/**
 * Remember each page's scroll position, and restore it on the way back.
 *
 * It used to read and write `window.scrollY` only — but the desktop layout
 * scrolls the content column, not the window, so nothing was ever saved and a
 * detail page opened at whatever offset the list had been scrolled to (the
 * column is the same element across routes). The phone layout scrolls the
 * document (App.css's responsive block), so which scroller it is depends on the layout.
 */
function scroller(): { get: () => number; set: (top: number) => void; target: EventTarget } {
  const column = document.getElementById("page-content");
  if (!window.matchMedia(PHONE_QUERY).matches && column) {
    return { get: () => column.scrollTop, set: (top) => column.scrollTo(0, top), target: column };
  }
  return { get: () => window.scrollY, set: (top) => window.scrollTo(0, top), target: window };
}

export default function ScrollRestoration() {
  const { pathname } = useLocation();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const s = scroller();
    // Save current scroll position for previous path
    const prevPath = prevPathRef.current;
    if (prevPath !== pathname) {
      sessionStorage.setItem(`scroll:${prevPath}`, String(s.get()));
    }
    prevPathRef.current = pathname;

    // Restore or scroll to top
    const saved = sessionStorage.getItem(`scroll:${pathname}`);
    if (saved) {
      requestAnimationFrame(() => s.set(Number(saved)));
    } else {
      s.set(0);
    }
  }, [pathname]);

  // Debounced scroll save
  useEffect(() => {
    const s = scroller();
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(`scroll:${pathname}`, String(s.get()));
      }, 150);
    };
    s.target.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      s.target.removeEventListener("scroll", handleScroll);
    };
  }, [pathname]);

  return null;
}
