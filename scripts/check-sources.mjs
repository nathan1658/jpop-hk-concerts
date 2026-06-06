import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { monitoredSources } from "../src/data/sources.ts";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strict = args.has("--strict");

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = rawArgs.indexOf(`--${name}`);
  return index === -1 ? undefined : rawArgs[index + 1];
};

const reportPath = getArgValue("report");
const checkedAt = new Date().toISOString();
const escapeAnnotation = (value) =>
  String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

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
        url: source.url,
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
        url: source.url,
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

console.table(
  checks.map(({ id, name, kind, authority, ok, status, ms, error }) => ({
    id,
    name,
    kind,
    authority,
    ok,
    status,
    ms,
    error,
  })),
);

const failedChecks = checks.filter((check) => !check.ok);

for (const check of failedChecks) {
  const message = `${check.name} (${check.id}) returned ${check.status}${
    check.error ? `: ${check.error}` : ""
  }`;
  console.warn(message);
  console.warn(`::warning title=Source unavailable::${escapeAnnotation(message)}`);
}

if (reportPath) {
  const reportDir = dirname(reportPath);

  if (reportDir !== ".") {
    await mkdir(reportDir, { recursive: true });
  }

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        checkedAt,
        sourceCount: checks.length,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote source check report to ${reportPath}`);
}

const hasCanonicalFailure = checks.some((check) => !check.ok && check.authority === "canonical");

process.exit(strict && hasCanonicalFailure ? 1 : 0);
