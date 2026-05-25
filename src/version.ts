import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };

export const VERSION = packageJson.version ?? "0.0.0";
