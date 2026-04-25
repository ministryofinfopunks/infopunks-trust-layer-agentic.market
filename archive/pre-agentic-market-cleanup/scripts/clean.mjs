import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const removeLocalState = process.argv.includes("--local");

const targets = [
  path.join(root, "apps", "site", ".next"),
  path.join(root, "apps", "site", "out"),
  path.join(root, "coverage"),
  path.join(root, "dist"),
  path.join(root, ".turbo"),
  path.join(root, "tmp"),
  path.join(root, ".DS_Store")
];

if (removeLocalState) {
  targets.push(path.join(root, "data", "local"));
}

const removed = [];

for (const target of targets) {
  if (!existsSync(target)) {
    continue;
  }
  rmSync(target, { force: true, recursive: true });
  removed.push(path.relative(root, target));
}

if (removed.length === 0) {
  console.log("clean ok: nothing to remove");
} else {
  console.log(`clean ok: removed ${removed.join(", ")}`);
}
