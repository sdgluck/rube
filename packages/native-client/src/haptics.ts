/**
 * Taps you can feel, in the apps.
 *
 * A native control answers a toggle, a committed swipe or a destructive
 * confirmation with a small tick; a WebView answers with nothing, which is one
 * of the ways a wrapped web app gives itself away. In a browser these are
 * no-ops: the Vibration API is a buzz, not a tick, and iOS Safari doesn't
 * implement it at all.
 */
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticKind = "light" | "medium" | "selection" | "success" | "warning" | "error";

export function haptic(kind: HapticKind = "light"): void {
  if (!Capacitor.isNativePlatform()) return;
  const run = () => {
    switch (kind) {
      case "light":
        return Haptics.impact({ style: ImpactStyle.Light });
      case "medium":
        return Haptics.impact({ style: ImpactStyle.Medium });
      case "selection":
        return Haptics.selectionChanged();
      case "success":
        return Haptics.notification({ type: NotificationType.Success });
      case "warning":
        return Haptics.notification({ type: NotificationType.Warning });
      case "error":
        return Haptics.notification({ type: NotificationType.Error });
    }
  };
  // Feedback, never a failure path.
  void run()?.catch(() => {});
}
