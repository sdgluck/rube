/**
 * The native (Capacitor) build of this SPA. See `@tinkerbell/native-client`
 * for how the bundled UI finds its server.
 *
 * `appId` and `server.hostname` are repeated from `NATIVE_APPS` in
 * `@tinkerbell/contracts` rather than imported: the Capacitor CLI compiles this
 * file to CommonJS on its own and can't follow a workspace package's raw
 * TypeScript. `src/native-config.test.ts` fails if the two drift — the hostname
 * is the origin the server allow-lists for CORS, and a mismatch shows up only
 * as every request being blocked on a device.
 */
/// <reference types="@capacitor/splash-screen" />
import type { CapacitorConfig } from "@capacitor/cli";
// Type-only: the CLI compiles this file to CommonJS and must not load the
// plugin's browser bundle. The enum's value is the string below.
import type { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "dev.tinkerbell.admin",
  appName: "Tinkerbell",
  // Not `dist`: that one is what the server serves, built for a same-origin
  // page. Keeping the two apart means a native build never ships to Docker.
  webDir: "dist-native",
  server: {
    hostname: "app.tinkerbell",
    androidScheme: "https",
  },
  ios: {
    // The page handles the safe areas itself (env(safe-area-inset-*)), so the
    // WebView must not add its own inset on top and shift everything down.
    contentInset: "never",
  },
  android: {
    // The app's origin is https, and most self-hosted servers on a LAN are
    // plain http. Without this the WebView blocks every request as mixed content.
    allowMixedContent: true,
  },
  plugins: {
    SystemBars: {
      // Edge to edge on Android, as Android 15 requires: the WebView runs
      // under both bars and the CSS pads with env(safe-area-inset-*). On
      // WebViews too old to report the insets, Capacitor pads the view instead.
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
    },
    Keyboard: {
      // The WebView shrinks to the space above the keyboard, so a pinned
      // footer or a sheet's buttons sit above it rather than under it.
      resize: "native" as KeyboardResize,
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      // Hidden by the app after its first render (`hideSplash`), so the user
      // never sees a white frame between the splash and the UI.
      launchAutoHide: false,
      backgroundColor: "#0a100f",
    },
  },
};

export default config;
