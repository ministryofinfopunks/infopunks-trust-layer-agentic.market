const poolByUrl = new Map();

async function loadPgModule() {
  try {
    return await import("pg");
  } catch (error) {
    throw new Error(
      `Postgres driver is not installed. Add dependency "pg" to use postgres-backed MCP adapter state. (${error?.message ?? "module load failed"})`
    );
  }
}

export async function getSharedPostgresPool(databaseUrl) {
  const normalized = String(databaseUrl ?? "").trim();
  if (!normalized) {
    throw new Error("Postgres database URL is required.");
  }
  if (poolByUrl.has(normalized)) {
    return poolByUrl.get(normalized);
  }
  const { Pool } = await loadPgModule();
  const pool = new Pool({
    connectionString: normalized,
    max: Number(process.env.MCP_ADAPTER_POSTGRES_POOL_MAX ?? 20),
    idleTimeoutMillis: Number(process.env.MCP_ADAPTER_POSTGRES_IDLE_TIMEOUT_MS ?? 30000),
    connectionTimeoutMillis: Number(process.env.MCP_ADAPTER_POSTGRES_CONNECT_TIMEOUT_MS ?? 5000)
  });
  poolByUrl.set(normalized, pool);
  return pool;
}

