import path from "node:path";
import { realpath } from "node:fs/promises";
import { SourceScoutError } from "./types.js";

export function normalizeRelativePath(input?: string): string {
  if (!input || input.trim() === "" || input === ".") {
    return ".";
  }

  const normalizedInput = input.replaceAll("\\", "/");
  if (normalizedInput.includes("\0")) {
    throw new SourceScoutError("INVALID_PATH", "path contains a null byte");
  }
  if (path.posix.isAbsolute(normalizedInput) || normalizedInput.startsWith("~")) {
    throw new SourceScoutError("INVALID_PATH", "path must be relative to the project root");
  }

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new SourceScoutError("INVALID_PATH", "path escapes the project root");
  }
  return normalized;
}

export function resolveRelativePath(projectRoot: string, relativePath?: string): string {
  const safePath = normalizeRelativePath(relativePath);
  return safePath === "." ? projectRoot : path.join(projectRoot, safePath);
}

export async function assertRealPathWithin(root: string, target: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  const relative = path.relative(realRoot, realTarget);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new SourceScoutError("INVALID_PATH", "resolved path escapes the project root");
}
