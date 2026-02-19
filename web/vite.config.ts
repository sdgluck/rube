import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [react(), mkcert({ hosts: ["tinkerbell.local"] })],
  server: {
    host: true,
    port: 443,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
