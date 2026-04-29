import { TrustPlatform } from "../../apps/api/lib/platform.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const environment = process.env.INFOPUNKS_ENVIRONMENT || "local";
const defaultDataDir = process.env.DATA_DIR
  || ((environment === "local" || environment === "test")
    ? fileURLToPath(new URL("../../data", import.meta.url))
    : path.join(os.tmpdir(), "infopunks"));

const platform = new TrustPlatform({
  dbPath: process.env.INFOPUNKS_DB_PATH || path.join(defaultDataDir, "infopunks.db"),
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-key"
});

const result = await platform.runScenario({ scenario: "seed" });
console.log(JSON.stringify(result, null, 2));
