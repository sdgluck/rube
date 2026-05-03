import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollRestoration() {
  const { pathname } = useLocation();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    // Save current scroll position for previous path
    const prevPath = prevPathRef.current;
    if (prevPath !== pathname) {
      sessionStorage.setItem(`scroll:${prevPath}`, String(window.scrollY));
    }
    prevPathRef.current = pathname;

    // Restore or scroll to top
    const saved = sessionStorage.getItem(`scroll:${pathname}`);
    if (saved) {
      requestAnimationFrame(() => {
        window.scrollTo(0, Number(saved));
      });
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  // Debounced scroll save
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(`scroll:${pathname}`, String(window.scrollY));
      }, 150);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [pathname]);

  return null;
}
