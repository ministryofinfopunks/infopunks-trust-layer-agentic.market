import { AdapterStateStore } from "./state-store.mjs";
import { PostgresAdapterStateStore } from "./postgres-state-store.mjs";
import { getSharedPostgresPool } from "./postgres-driver.mjs";

export async function createAdapterStateStore(config) {
  if (config.stateStoreDriver === "sqlite") {
    return new AdapterStateStore({ dbPath: config.stateDbPath });
  }
  if (config.stateStoreDriver === "postgres") {
    const pool = await getSharedPostgresPool(config.stateStoreDatabaseUrl);
    const store = new PostgresAdapterStateStore({ pool });
    await store.init();
    return store;
  }
  throw new Error(`Unsupported MCP adapter state store driver: ${config.stateStoreDriver}`);
}
