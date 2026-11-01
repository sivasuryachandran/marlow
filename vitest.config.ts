import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["packages/**/*.test.ts", "server/**/*.test.ts", "tools/**/*.test.ts", "web/src/**/*.test.ts"] } });
