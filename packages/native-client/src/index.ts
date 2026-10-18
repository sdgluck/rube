/**
 * What is left of the Capacitor client: the pieces of the SPAs' phone layer —
 * platform detection, push/pop transitions, Back closing an overlay, and the
 * on-screen keyboard. All browser-only.
 *
 * Here rather than in the SPAs because both use them and the portal may not
 * import the admin app's code. It goes when the phone layer is replaced by
 * plain responsive CSS (Phase 4, step 4 of the native-app plan); the native
 * apps live in `native/`.
 */
export { watchKeyboard } from "./keyboard.ts";
export { pushOverlay } from "./overlay-history.ts";
export { detectPlatform, getPlatform, type Platform } from "./platform.ts";
export {
  markTabNavigation,
  navigateBack,
  runTransition,
  takeNavigationHint,
  transitionFor,
  transitionsEnabled,
  type NavDirection,
} from "./transitions.ts";
