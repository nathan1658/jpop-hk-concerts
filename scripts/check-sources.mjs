import { monitoredSources } from "../src/data/sources.ts";

const checks = await Promise.all(
  monitoredSources.map(async (source) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(source.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "jpop-hk-concerts-source-check/0.1",
        },
      });

      return {
        id: source.id,
        name: source.name,
        kind: source.kind,
        authority: source.authority,
        ok: response.ok,
        status: response.status,
        ms: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        id: source.id,
        name: source.name,
        kind: source.kind,
        authority: source.authority,
        ok: false,
        status: "network-error",
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }),
);

console.table(checks);

process.exit(checks.some((check) => !check.ok && check.authority === "canonical") ? 1 : 0);
