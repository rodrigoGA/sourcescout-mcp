import type { AppConfig, RegisteredProject } from "../types.js";
import { SourceScoutError } from "../types.js";
import { runCommand } from "../commandRunner.js";
import { clampInt } from "../limits.js";
import { normalizeRelativePath } from "../pathSafety.js";

interface RipgrepMatch {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{ match?: { text?: string }; start?: number; end?: number }>;
  };
}

export class GrepAdapter {
  constructor(private readonly config: AppConfig) {}

  async grep(project: RegisteredProject, input: {
    pattern: string;
    paths?: string | string[];
    ignoreCase?: boolean;
    count?: boolean;
    context?: number;
    path?: string;
    literal?: boolean;
    case_sensitive?: boolean;
    glob?: string;
    max_results?: number;
  }): Promise<unknown> {
    const maxResults = clampInt(input.max_results, 50, 1, this.config.limits.max_search_results);
    const searchPaths = this.normalizePaths(input.paths ?? input.path ?? ".");
    const args = input.count
      ? ["--count", "--line-number", "--color", "never"]
      : ["--json", "--line-number", "--color", "never"];
    if (input.literal) {
      args.push("--fixed-strings");
    }
    if (input.ignoreCase || input.case_sensitive === false) {
      args.push("--ignore-case");
    }
    if (!input.count && input.context !== undefined) {
      args.push("--context", String(input.context));
    }
    if (input.glob) {
      args.push("--glob", input.glob);
    }
    args.push(input.pattern, ...searchPaths);

    const result = await runCommand("rg", args, {
      cwd: project.localPath,
      timeoutMs: this.timeoutMs(),
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (![0, 1].includes(result.exitCode ?? -1) || result.timedOut) {
      throw new SourceScoutError(
        "RG_FAILED",
        `rg failed: ${result.stderr || result.stdout}`,
        500,
        result,
      );
    }

    if (input.count) {
      return {
        project_id: project.config.id,
        pattern: input.pattern,
        paths: searchPaths,
        counts: this.parseCounts(result.stdout),
        truncated: result.truncated,
      };
    }

    const matches = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => this.parseMatch(line))
      .slice(0, maxResults);

    return {
      project_id: project.config.id,
      pattern: input.pattern,
      paths: searchPaths,
      matches,
      truncated: result.truncated || matches.length >= maxResults,
    };
  }

  private normalizePaths(paths: string | string[]): string[] {
    const rawPaths = Array.isArray(paths) ? paths : [paths];
    return rawPaths.map((path) => normalizeRelativePath(path));
  }

  private timeoutMs(): number {
    const seconds = clampInt(
      this.config.limits.command_timeout_seconds,
      300,
      1,
      this.config.limits.command_timeout_seconds,
    );
    return seconds * 1000;
  }

  private parseMatch(line: string): Array<{
    kind: "match" | "context";
    path: string;
    line_number: number;
    line: string;
    submatches: Array<{ text: string; start: number; end: number }>;
  }> {
    let parsed: RipgrepMatch;
    try {
      parsed = JSON.parse(line) as RipgrepMatch;
    } catch {
      return [];
    }
    if (!["match", "context"].includes(parsed.type) || !parsed.data?.path?.text || !parsed.data.line_number) {
      return [];
    }
    return [
      {
        kind: parsed.type as "match" | "context",
        path: parsed.data.path.text,
        line_number: parsed.data.line_number,
        line: parsed.data.lines?.text?.replace(/\r?\n$/, "") ?? "",
        submatches:
          parsed.data.submatches?.map((match) => ({
            text: match.match?.text ?? "",
            start: match.start ?? 0,
            end: match.end ?? 0,
          })) ?? [],
      },
    ];
  }

  private parseCounts(output: string): Array<{ path: string; count: number }> {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const separator = line.lastIndexOf(":");
        if (separator === -1) {
          return [];
        }
        const count = Number.parseInt(line.slice(separator + 1), 10);
        if (!Number.isFinite(count)) {
          return [];
        }
        return [{ path: line.slice(0, separator), count }];
      });
  }
}
