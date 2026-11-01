import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "../assets",
  server: { fs: { allow: [".."] }, proxy: { "/ws": { target: "ws://localhost:8787", ws: true }, "/api": "http://localhost:8787", "/casefiles": "http://localhost:8787" } },
});
