import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const apiEntry = path.join(repoRoot, "apps", "api", "server.mjs");
const simulatorEntry = path.join(repoRoot, "apps", "simulator", "run.mjs");

const port = Number(process.env.PORT || 4010);
const environment = process.env.INFOPUNKS_ENVIRONMENT || "local";
const dataDir = path.join(repoRoot, "data", "local");
const dbPath = process.env.INFOPUNKS_DB_PATH || path.join(dataDir, "infopunks.local.db");
const baseUrl = process.env.INFOPUNKS_BASE_URL || `http://127.0.0.1:${port}`;

const rootKey = process.env.INFOPUNKS_API_KEY || "dev-infopunks-root-key";
const readKey = process.env.INFOPUNKS_READ_API_KEY || "dev-infopunks-read-key";
const apiKeys = process.env.INFOPUNKS_API_KEYS_JSON
  ? process.env.INFOPUNKS_API_KEYS_JSON
  : JSON.stringify([
      {
        token: rootKey,
        key_id: "key_local_root",
        caller_id: "local-root",
        scopes: ["read", "write"],
        environment
      },
      {
        token: readKey,
        key_id: "key_local_read",
        caller_id: "local-reader",
        scopes: ["read"],
        environment
      }
    ]);

const fresh = process.argv.includes("--fresh");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await sleep(150);
  }
  throw new Error("API server did not become healthy in time.");
}

function printBanner() {
  process.stdout.write(
    [
      "",
      "Infopunks Trust Layer is live.",
      `War Room: ${baseUrl}/war-room`,
      `Health:   ${baseUrl}/healthz`,
      `Root key: ${rootKey}`,
      `Read key: ${readKey}`,
      "",
      "Press Ctrl+C to stop the API server."
    ].join("\n") + "\n"
  );
}

mkdirSync(dataDir, { recursive: true });
if (fresh) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${dbPath}${suffix}`;
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
}

const child = spawn(process.execPath, [apiEntry], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    INFOPUNKS_ENVIRONMENT: environment,
    INFOPUNKS_API_KEY: rootKey,
    INFOPUNKS_API_KEYS_JSON: apiKeys,
    INFOPUNKS_DB_PATH: dbPath,
    INFOPUNKS_BASE_URL: baseUrl
  },
  stdio: "inherit"
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});

await waitForHealth(baseUrl);

const seed = spawn(process.execPath, [simulatorEntry, "demo"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    INFOPUNKS_API_KEY: rootKey,
    INFOPUNKS_BASE_URL: baseUrl
  },
  stdio: "inherit"
});

const seedExitCode = await new Promise((resolve) => {
  seed.on("exit", (code) => resolve(code ?? 0));
});

if (seedExitCode !== 0) {
  shutdown("SIGTERM");
  throw new Error(`Simulator bootstrap failed with exit code ${seedExitCode}.`);
}

printBanner();
