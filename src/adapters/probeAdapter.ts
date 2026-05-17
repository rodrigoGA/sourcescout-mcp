import type { AppConfig, RegisteredProject } from "../types.js";
import { SourceScoutError } from "../types.js";
import { runCommand } from "../commandRunner.js";
import { clampInt } from "../limits.js";
import { normalizeRelativePath } from "../pathSafety.js";

export class ProbeAdapter {
  constructor(private readonly config: AppConfig) {}

  async searchCode(project: RegisteredProject, input: {
    query: string;
    path?: string;
    language?: string;
    maxResults?: number;
    maxTokens?: number;
    max_results?: number;
    max_tokens?: number;
    allowTests?: boolean;
    strictElasticSyntax?: boolean;
    session?: string;
    allow_tests?: boolean;
    exact?: boolean;
    reranker?: "bm25" | "tfidf" | "hybrid" | "hybrid2";
    format?: "markdown" | "plain" | "json" | "xml" | "outline" | "outline-xml";
  }): Promise<unknown> {
    const targetPath = normalizeRelativePath(input.path);
    const args = [
      "search",
      input.query,
      targetPath,
      "--format",
      input.format ?? "json",
    ];
    const maxResults = input.maxResults ?? input.max_results;
    if (maxResults !== undefined) {
      args.push("--max-results", String(clampInt(maxResults, maxResults, 1, this.config.limits.max_search_results)));
    }
    const maxTokens = input.maxTokens ?? input.max_tokens;
    if (maxTokens !== undefined) {
      args.push("--max-tokens", String(clampInt(maxTokens, maxTokens, 100, this.config.limits.max_tool_output_bytes)));
    }
    if (input.language) {
      args.push("--language", input.language);
    }
    if (input.allowTests ?? input.allow_tests) {
      args.push("--allow-tests");
    }
    if (input.exact) {
      args.push("--exact");
    }
    if (input.strictElasticSyntax) {
      args.push("--strict-elastic-syntax");
    }
    if (input.session) {
      args.push("--session", input.session);
    }
    if (input.reranker) {
      args.push("--reranker", input.reranker);
    }
    return this.runProbe(project, args, {
      project_id: project.config.id,
      query: input.query,
      path: targetPath,
      session: input.session,
    });
  }

  async queryCode(project: RegisteredProject, input: {
    pattern: string;
    path?: string;
    language?: string;
    ignore?: string[];
    maxResults?: number;
    max_results?: number;
    allowTests?: boolean;
    withContext?: boolean;
    allow_tests?: boolean;
    format?: "markdown" | "plain" | "json" | "xml" | "color" | "outline-xml";
  }): Promise<unknown> {
    const targetPath = normalizeRelativePath(input.path);
    const args = [
      "query",
      input.pattern,
      targetPath,
      "--format",
      input.format ?? "json",
    ];
    const maxResults = input.maxResults ?? input.max_results;
    if (maxResults !== undefined) {
      args.push("--max-results", String(clampInt(maxResults, maxResults, 1, this.config.limits.max_search_results)));
    }
    if (input.language) {
      args.push("--language", input.language);
    }
    for (const ignore of input.ignore ?? []) {
      args.push("--ignore", ignore);
    }
    if (input.allowTests ?? input.allow_tests) {
      args.push("--allow-tests");
    }
    if (input.withContext) {
      args.push("--with-context");
    }
    return this.runProbe(project, args, {
      project_id: project.config.id,
      pattern: input.pattern,
      path: targetPath,
    });
  }

  async extractCode(project: RegisteredProject, input: {
    files: string[];
    contextLines?: number;
    context?: number;
    allowTests?: boolean;
    timeout?: number;
    allow_tests?: boolean;
    format?: "markdown" | "plain" | "json";
  }): Promise<unknown> {
    const files = input.files.map((file) => this.normalizeProbeTarget(file));
    const args = ["extract", ...files];
    const contextLines = input.contextLines ?? input.context;
    if (contextLines !== undefined) {
      args.push("--context", String(contextLines));
    }
    if (input.allowTests ?? input.allow_tests) {
      args.push("--allow-tests");
    }
    args.push("--format", input.format ?? "markdown");
    return this.runProbe(project, args, {
      project_id: project.config.id,
      files,
    }, input.timeout);
  }

  async listSymbols(project: RegisteredProject, input: {
    files: string[];
    allowTests?: boolean;
    allow_tests?: boolean;
    format?: "text" | "json";
  }): Promise<unknown> {
    const files = input.files.map((file) => normalizeRelativePath(file));
    const args = ["symbols", ...files];
    if (input.allowTests ?? input.allow_tests) {
      args.push("--allow-tests");
    }
    args.push("--format", input.format ?? "json");
    const result = await runCommand(this.config.probe.binary, args, {
      cwd: project.localPath,
      timeoutMs: this.timeoutMs(),
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new SourceScoutError(
        "PROBE_FAILED",
        `probe ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
        500,
        result,
      );
    }

    const parsed = this.tryParseJson(result.stdout);
    return {
      project_id: project.config.id,
      files,
      result: parsed ?? {},
      truncated: result.truncated,
    };
  }

  private async runProbe(
    project: RegisteredProject,
    args: string[],
    envelope: Record<string, unknown>,
    timeoutSeconds?: number,
  ): Promise<unknown> {
    const result = await runCommand(this.config.probe.binary, args, {
      cwd: project.localPath,
      timeoutMs: this.timeoutMs(timeoutSeconds),
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new SourceScoutError(
        "PROBE_FAILED",
        `probe ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
        500,
        result,
      );
    }

    const parsed = this.tryParseJson(result.stdout);
    if (parsed !== undefined) {
      return { ...envelope, result: parsed, truncated: result.truncated };
    }
    return { ...envelope, raw_output: result.stdout, truncated: result.truncated };
  }

  private normalizeProbeTarget(target: string): string {
    const separatorIndex = this.findTargetSeparator(target);
    const pathPart = separatorIndex === -1 ? target : target.slice(0, separatorIndex);
    const suffix = separatorIndex === -1 ? "" : target.slice(separatorIndex);
    return `${normalizeRelativePath(pathPart)}${suffix}`;
  }

  private findTargetSeparator(target: string): number {
    const colon = target.indexOf(":");
    const hash = target.indexOf("#");
    if (colon === -1) {
      return hash;
    }
    if (hash === -1) {
      return colon;
    }
    return Math.min(colon, hash);
  }

  private timeoutMs(timeoutSeconds?: number): number {
    const seconds = clampInt(
      timeoutSeconds,
      this.config.limits.command_timeout_seconds,
      1,
      this.config.limits.command_timeout_seconds,
    );
    return seconds * 1000;
  }

  private tryParseJson(raw: string): unknown | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }

    for (const candidate of this.jsonCandidates(trimmed)) {
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private jsonCandidates(output: string): string[] {
    const candidates = [output];
    const firstJson = output.search(/[\[{]/);
    if (firstJson >= 0) {
      const opening = output[firstJson];
      const closing = opening === "{" ? "}" : "]";
      const lastJson = output.lastIndexOf(closing);
      if (lastJson > firstJson) {
        candidates.push(output.slice(firstJson, lastJson + 1));
      }
    }
    return candidates;
  }

}
