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
import type { CapacitorConfig } from "@capacitor/cli";

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
  android: {
    // The app's origin is https, and most self-hosted servers on a LAN are
    // plain http. Without this the WebView blocks every request as mixed content.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      // Hidden by the app after its first render (`hideSplash`), so the user
      // never sees a white frame between the splash and the UI.
      launchAutoHide: false,
      backgroundColor: "#0a100f",
    },
  },
};

export default config;
