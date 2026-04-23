import { TrustPlatform } from "../../apps/api/lib/platform.mjs";

const platform = new TrustPlatform({
  dbPath: process.env.INFOPUNKS_DB_PATH || new URL("../../data/infopunks.db", import.meta.url).pathname,
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-key"
});

const result = await platform.runScenario({ scenario: "seed" });
console.log(JSON.stringify(result, null, 2));
