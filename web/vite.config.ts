import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (f: string) => fileURLToPath(new URL(`./${f}`, import.meta.url));
export default defineConfig({
  publicDir: "../assets",
  // main.ts loads a generated mission with a top-level await; every browser the game needs (Web Audio HRTF, MediaRecorder) supports it
  build: { target: "es2022", rollupOptions: { input: { main: page("index.html"), seer: page("seer.html"), record: page("record.html"), split: page("split.html") } } },
  server: { fs: { allow: [".."] }, proxy: { "/ws": { target: "ws://localhost:8787", ws: true }, "/api": "http://localhost:8787", "/casefiles": "http://localhost:8787" } },
});
