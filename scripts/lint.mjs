import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "data" || entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".mjs")) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = listFiles(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`lint ok: ${files.length} files`);
