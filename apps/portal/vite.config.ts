import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, proxy the portal API to the user-portal port.
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
