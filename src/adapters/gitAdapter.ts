import type { AppConfig, RegisteredProject } from "../types.js";
import { SourceScoutError } from "../types.js";
import { runCommand } from "../commandRunner.js";
import { clampInt, truncateText } from "../limits.js";
import { normalizeRelativePath } from "../pathSafety.js";

type GitOperation =
  | "log"
  | "show_commit"
  | "diff"
  | "changed_files"
  | "tags"
  | "branches"
  | "blame"
  | "search_history_text"
  | "search_history_regex"
  | "show_file_at_revision";

export class GitAdapter {
  constructor(private readonly config: AppConfig) {}

  async query(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const operation = input.operation as GitOperation;
    switch (operation) {
      case "log":
        return this.log(project, input);
      case "show_commit":
        return this.showCommit(project, input);
      case "diff":
        return this.diff(project, input);
      case "changed_files":
        return this.changedFiles(project, input);
      case "tags":
        return this.tags(project, input);
      case "branches":
        return this.branches(project, input);
      case "blame":
        return this.blame(project, input);
      case "search_history_text":
        return this.searchHistory(project, input, "-S", "text");
      case "search_history_regex":
        return this.searchHistory(project, input, "-G", "regex");
      case "show_file_at_revision":
        return this.showFileAtRevision(project, input);
      default:
        throw new SourceScoutError("INVALID_GIT_OPERATION", `unsupported git operation: ${String(operation)}`);
    }
  }

  private async log(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const limit = this.limit(input.limit);
    const args = [
      "log",
      "--date=iso",
      `--max-count=${limit}`,
      "--pretty=format:%H%x09%an%x09%ae%x09%ad%x09%s",
    ];
    if (typeof input.since === "string" && input.since.trim()) {
      args.push(`--since=${input.since}`);
    }
    this.addPathspec(args, input.path);
    const output = await this.run(project, args);
    return {
      project_id: project.config.id,
      operation: "log",
      commits: this.parseLog(output.stdout, true),
      truncated: output.truncated,
    };
  }

  private async showCommit(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const revision = this.safeRevision(input.revision, "revision");
    const includePatch = input.include_patch === true;
    const maxBytes = this.maxOutputBytes(input.max_output_bytes);
    const args = ["show", "--stat", includePatch ? "--patch" : "--no-patch", revision];
    const output = await this.run(project, args, maxBytes);
    return {
      project_id: project.config.id,
      operation: "show_commit",
      revision,
      output: output.stdout,
      truncated: output.truncated,
    };
  }

  private async diff(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const base = this.safeRevision(input.base, "base");
    const head = this.safeRevision(input.head, "head");
    const contextLines = clampInt(input.context_lines, 3, 0, 200);
    const args = ["diff", `--unified=${contextLines}`, `${base}..${head}`];
    this.addPathspec(args, input.path);
    const output = await this.run(project, args, this.maxOutputBytes(input.max_output_bytes));
    return {
      project_id: project.config.id,
      operation: "diff",
      base,
      head,
      output: output.stdout,
      truncated: output.truncated,
    };
  }

  private async changedFiles(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const base = this.safeRevision(input.base, "base");
    const head = this.safeRevision(input.head, "head");
    const args = ["diff", "--name-status", `${base}..${head}`];
    this.addPathspec(args, input.path);
    const output = await this.run(project, args);
    const files = output.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split(/\t+/);
        return { status, path: rest.join("\t") };
      });
    return {
      project_id: project.config.id,
      operation: "changed_files",
      base,
      head,
      files,
      truncated: output.truncated,
    };
  }

  private async tags(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const limit = this.limit(input.limit);
    const output = await this.run(project, ["tag", "--list", "--sort=-creatordate"]);
    return {
      project_id: project.config.id,
      operation: "tags",
      tags: output.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit),
      truncated: output.truncated,
    };
  }

  private async branches(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const args = ["branch"];
    if (input.remote === true) {
      args.push("-a");
    }
    args.push("--format=%(refname:short)");
    const output = await this.run(project, args);
    return {
      project_id: project.config.id,
      operation: "branches",
      branches: output.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      truncated: output.truncated,
    };
  }

  private async blame(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    if (typeof input.path !== "string") {
      throw new SourceScoutError("INVALID_INPUT", "blame requires path");
    }
    const relativePath = normalizeRelativePath(input.path);
    const startLine = clampInt(input.start_line, 1, 1, Number.MAX_SAFE_INTEGER);
    const endLine = clampInt(input.end_line, startLine, startLine, startLine + this.config.limits.max_file_lines - 1);
    const output = await this.run(project, [
      "blame",
      "-L",
      `${startLine},${endLine}`,
      "--line-porcelain",
      "--",
      relativePath,
    ]);
    return {
      project_id: project.config.id,
      operation: "blame",
      path: relativePath,
      lines: this.parseBlame(output.stdout, startLine),
      truncated: output.truncated,
    };
  }

  private async searchHistory(
    project: RegisteredProject,
    input: Record<string, unknown>,
    flag: "-S" | "-G",
    field: "text" | "regex",
  ): Promise<unknown> {
    const needle = input[field];
    if (typeof needle !== "string" || !needle) {
      throw new SourceScoutError("INVALID_INPUT", `${field} is required`);
    }
    const limit = this.limit(input.limit);
    const args = [
      "log",
      flag,
      needle,
      "--date=iso",
      `--max-count=${limit}`,
      "--pretty=format:%H%x09%an%x09%ae%x09%ad%x09%s",
    ];
    this.addPathspec(args, input.path);
    const output = await this.run(project, args);
    return {
      project_id: project.config.id,
      operation: flag === "-S" ? "search_history_text" : "search_history_regex",
      commits: this.parseLog(output.stdout, true),
      truncated: output.truncated,
    };
  }

  private async showFileAtRevision(project: RegisteredProject, input: Record<string, unknown>): Promise<unknown> {
    const revision = this.safeRevision(input.revision, "revision");
    if (typeof input.path !== "string") {
      throw new SourceScoutError("INVALID_INPUT", "show_file_at_revision requires path");
    }
    const relativePath = normalizeRelativePath(input.path);
    if (relativePath === ".") {
      throw new SourceScoutError("INVALID_PATH", "show_file_at_revision requires a file path");
    }
    const output = await this.run(project, ["show", `${revision}:${relativePath}`], this.maxOutputBytes(input.max_output_bytes));
    const truncated = truncateText(output.stdout, this.maxOutputBytes(input.max_output_bytes));
    return {
      project_id: project.config.id,
      operation: "show_file_at_revision",
      revision,
      path: relativePath,
      content: truncated.text,
      truncated: output.truncated || truncated.truncated,
    };
  }

  private async run(project: RegisteredProject, args: string[], maxOutputBytes = this.config.limits.max_tool_output_bytes) {
    const result = await runCommand("git", args, {
      cwd: project.localPath,
      timeoutMs: this.config.git.timeout_seconds * 1000,
      maxOutputBytes,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new SourceScoutError(
        "GIT_FAILED",
        `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
        500,
        result,
      );
    }
    return result;
  }

  private parseLog(
    stdout: string,
    includeEmail: boolean,
  ): Array<{ sha: string; author_name: string; author_email?: string; date: string; subject: string }> {
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        if (includeEmail) {
          const [sha, author_name, author_email, date, ...subjectParts] = parts;
          return { sha, author_name, author_email, date, subject: subjectParts.join("\t") };
        }
        const [sha, author_name, date, ...subjectParts] = parts;
        return { sha, author_name, date, subject: subjectParts.join("\t") };
      });
  }

  private parseBlame(stdout: string, startLine: number): Array<{ line: number; sha: string; author: string; content: string }> {
    const results: Array<{ line: number; sha: string; author: string; content: string }> = [];
    let currentSha = "";
    let currentAuthor = "";
    let currentLine = startLine;
    for (const line of stdout.split(/\r?\n/)) {
      if (/^[0-9a-f]{40}\s/.test(line)) {
        currentSha = line.split(" ")[0] ?? "";
      } else if (line.startsWith("author ")) {
        currentAuthor = line.slice("author ".length);
      } else if (line.startsWith("\t")) {
        results.push({
          line: currentLine,
          sha: currentSha,
          author: currentAuthor,
          content: line.slice(1),
        });
        currentLine += 1;
      }
    }
    return results;
  }

  private addPathspec(args: string[], pathValue: unknown): void {
    if (typeof pathValue !== "string" || !pathValue.trim()) {
      return;
    }
    args.push("--", normalizeRelativePath(pathValue));
  }

  private limit(value: unknown): number {
    return clampInt(
      value,
      this.config.git.default_log_limit,
      1,
      this.config.limits.max_git_log_limit,
    );
  }

  private maxOutputBytes(value: unknown): number {
    return clampInt(value, this.config.limits.max_tool_output_bytes, 1, this.config.limits.max_tool_output_bytes);
  }

  private safeRevision(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new SourceScoutError("INVALID_INPUT", `${field} is required`);
    }
    const revision = value.trim();
    if (revision.startsWith("-") || /[\0\r\n\t ]/.test(revision)) {
      throw new SourceScoutError("INVALID_REVISION", `${field} is not a safe Git revision`);
    }
    return revision;
  }
}
