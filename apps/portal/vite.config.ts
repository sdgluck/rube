import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so localias can map portal.tinkerbell.localhost to it (.localias.yaml).
    port: 5174,
    strictPort: true,
    allowedHosts: [".tinkerbell.localhost"],
    // In dev, proxy the portal API to the user-portal port.
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
