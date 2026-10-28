export interface Config {
  port: number; base: string; modelApiKey?: string; basetenKey?: string;
  intentBackend: "mock" | "meta" | "baseten"; timeoutMs: number; runsDir: string; casefilesDir: string; verifyArt: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const b = (env.INTENT_BACKEND ?? "mock") as Config["intentBackend"];
  return {
    port: Number(env.PORT ?? 8787), base: env.META_API_BASE ?? "https://api.meta.ai/v1",
    modelApiKey: env.MODEL_API_KEY || undefined, basetenKey: env.BASETEN_API_KEY || undefined,
    intentBackend: ["mock", "meta", "baseten"].includes(b) ? b : "mock",
    timeoutMs: Number(env.TURN_TIMEOUT_MS ?? 7000), runsDir: env.RUNS_DIR ?? "runs",
    casefilesDir: env.CASEFILES_DIR ?? "casefiles", verifyArt: env.VERIFY_ART === "1",
  };
}
