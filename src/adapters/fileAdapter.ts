import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import type { AppConfig, RegisteredProject } from "../types.js";
import { SourceScoutError } from "../types.js";
import { runCommand } from "../commandRunner.js";
import { clampInt } from "../limits.js";
import { assertRealPathWithin, normalizeRelativePath, resolveRelativePath } from "../pathSafety.js";

export class FileAdapter {
  constructor(private readonly config: AppConfig) {}

  async readFile(project: RegisteredProject, input: {
    path: string;
    start_line?: number;
    end_line?: number;
  }): Promise<{
    project_id: string;
    path: string;
    start_line: number;
    end_line: number;
    content: string;
    total_lines: number;
    truncated: boolean;
  }> {
    const relativePath = normalizeRelativePath(input.path);
    if (relativePath === ".") {
      throw new SourceScoutError("INVALID_PATH", "read_file requires a file path");
    }

    const absolutePath = resolveRelativePath(project.localPath, relativePath);
    await assertRealPathWithin(project.localPath, absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new SourceScoutError("NOT_A_FILE", `path is not a file: ${relativePath}`);
    }
    if (fileStat.size > this.config.limits.max_file_bytes) {
      throw new SourceScoutError(
        "FILE_TOO_LARGE",
        `file exceeds max_file_bytes (${this.config.limits.max_file_bytes}): ${relativePath}`,
      );
    }

    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;
    const startLine = clampInt(input.start_line, 1, 1, Math.max(1, totalLines));
    const requestedEnd = input.end_line ?? Math.min(totalLines, startLine + this.config.limits.max_file_lines - 1);
    const endLine = clampInt(requestedEnd, startLine, startLine, totalLines);
    const maxEndLine = Math.min(endLine, startLine + this.config.limits.max_file_lines - 1);
    const selected = lines.slice(startLine - 1, maxEndLine);
    const content = selected.map((line, index) => `${startLine + index}: ${line}`).join("\n");

    return {
      project_id: project.config.id,
      path: relativePath,
      start_line: startLine,
      end_line: maxEndLine,
      content,
      total_lines: totalLines,
      truncated: maxEndLine < endLine,
    };
  }

  async listFiles(project: RegisteredProject, input: {
    path?: string;
    glob?: string;
    max_results?: number;
  }): Promise<{ project_id: string; files: string[]; truncated: boolean }> {
    const basePath = normalizeRelativePath(input.path);
    const maxResults = clampInt(input.max_results, 500, 1, this.config.limits.max_search_results * 100);
    const files = (await this.gitLsFiles(project)) ?? (await this.walkFiles(project.localPath, maxResults * 2));
    const filtered = files.filter((file) => {
      if (basePath !== "." && file !== basePath && !file.startsWith(`${basePath}/`)) {
        return false;
      }
      if (input.glob && !minimatch(path.posix.basename(file), input.glob) && !minimatch(file, input.glob)) {
        return false;
      }
      return true;
    });
    const sliced = filtered.slice(0, maxResults);
    return {
      project_id: project.config.id,
      files: sliced,
      truncated: filtered.length > sliced.length,
    };
  }

  async overview(project: RegisteredProject): Promise<{
    project_id: string;
    root: string;
    current_head: string | null;
    file_count: number;
    top_level: string[];
    extensions: Array<{ extension: string; count: number }>;
  }> {
    const files = (await this.gitLsFiles(project)) ?? (await this.walkFiles(project.localPath, 20000));
    const topLevel = new Set<string>();
    const extensionCounts = new Map<string, number>();
    for (const file of files) {
      const first = file.split("/")[0];
      if (first) {
        topLevel.add(first);
      }
      const extension = path.extname(file).toLowerCase() || "[no extension]";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    }

    const extensions = [...extensionCounts.entries()]
      .map(([extension, count]) => ({ extension, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      project_id: project.config.id,
      root: project.localPath,
      current_head: project.state.current_head,
      file_count: files.length,
      top_level: [...topLevel].sort().slice(0, 100),
      extensions,
    };
  }

  private async gitLsFiles(project: RegisteredProject): Promise<string[] | null> {
    const result = await runCommand("git", ["ls-files"], {
      cwd: project.localPath,
      timeoutMs: this.config.git.timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }

  private async walkFiles(root: string, limit: number): Promise<string[]> {
    const results: string[] = [];
    const visit = async (absoluteDir: string, relativeDir: string): Promise<void> => {
      if (results.length >= limit) {
        return;
      }
      const entries = await readdir(absoluteDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        const absolute = path.join(absoluteDir, entry.name);
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await visit(absolute, relative);
        } else if (entry.isFile()) {
          results.push(relative);
          if (results.length >= limit) {
            return;
          }
        }
      }
    };
    await visit(root, "");
    return results;
  }
}
