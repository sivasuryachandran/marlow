import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "../assets",
  server: { fs: { allow: [".."] }, proxy: { "/api": "http://localhost:8787", "/casefiles": "http://localhost:8787" } },
});
