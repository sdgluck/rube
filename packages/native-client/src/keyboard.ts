/**
 * Whether the on-screen keyboard is up, as `<html data-keyboard="open">`.
 *
 * The bottom tab bar is `position: fixed`, so with the keyboard open it either
 * sat on top of the keyboard, eating a fifth of what was left of the screen,
 * or — where the viewport doesn't resize — covered the field being typed in.
 * Native apps hide the tab bar while typing; the stylesheet does the same off
 * this attribute.
 *
 * The visual viewport shrinking well below the layout viewport while a field
 * has focus is the only signal a mobile browser gives.
 */

function set(open: boolean): void {
  if (open) document.documentElement.dataset.keyboard = "open";
  else delete document.documentElement.dataset.keyboard;
}

export function watchKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const el = document.activeElement;
    const typing =
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    // A keyboard takes well over a quarter of a phone screen; browser chrome
    // collapsing and expanding moves the viewport by far less.
    set(typing && vv.height < window.innerHeight * 0.75);
  };
  vv.addEventListener("resize", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", () => setTimeout(update, 50));
}
