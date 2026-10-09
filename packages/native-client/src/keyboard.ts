/**
 * Whether the on-screen keyboard is up, as `<html data-keyboard="open">`.
 *
 * The bottom tab bar is `position: fixed`, so with the keyboard open it either
 * sat on top of the keyboard, eating a fifth of what was left of the screen,
 * or — where the viewport doesn't resize — covered the field being typed in.
 * Native apps hide the tab bar while typing; the stylesheet does the same off
 * this attribute.
 *
 * In the apps the Keyboard plugin says so directly. In a mobile browser the
 * visual viewport shrinking well below the layout viewport while a field has
 * focus is the only signal there is.
 */
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

function set(open: boolean): void {
  if (open) document.documentElement.dataset.keyboard = "open";
  else delete document.documentElement.dataset.keyboard;
}

export async function watchKeyboard(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Keyboard.addListener("keyboardWillShow", () => set(true));
    await Keyboard.addListener("keyboardWillHide", () => set(false));
    return;
  }
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
