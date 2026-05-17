import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppConfig, ToolName } from "./types.js";
import { SourceScoutError } from "./types.js";
import { ProjectRegistry } from "./projectRegistry.js";
import { RepoSyncManager } from "./repoSyncManager.js";
import { FileAdapter } from "./adapters/fileAdapter.js";
import { ProbeAdapter } from "./adapters/probeAdapter.js";
import { GrepAdapter } from "./adapters/grepAdapter.js";
import { GitAdapter } from "./adapters/gitAdapter.js";

const gitOperationSchema = z.enum([
  "log",
  "show_commit",
  "diff",
  "changed_files",
  "tags",
  "branches",
  "blame",
  "search_history_text",
  "search_history_regex",
  "show_file_at_revision",
]);

const gitQueryDescription = [
  "Run bounded read-only Git queries for a configured SourceScout project. This is not a shell: choose one operation and pass only the documented fields for that operation.",
  "Operations:",
  "- log: list commits. Fields: path, limit, since, until, author.",
  "- show_commit: show one commit. Fields: revision, include_patch, max_output_bytes.",
  "- diff: show diff between refs. Fields: base, head, path, context_lines, max_output_bytes.",
  "- changed_files: list changed files between refs. Fields: base, head, path.",
  "- tags: list tags sorted newest first. Fields: limit.",
  "- branches: list local or all branches. Fields: remote.",
  "- blame: line-level authorship. Fields: path, start_line, end_line.",
  "- search_history_text: git log -S text search. Fields: text, path, limit.",
  "- search_history_regex: git log -G regex search. Fields: regex, path, limit.",
  "- show_file_at_revision: read a file as it existed at a revision. Fields: revision, path, start_line, end_line, max_output_bytes.",
  "All paths are relative to the project root. Output is capped by config limits.",
].join("\n");

export function buildMcpServer(
  config: AppConfig,
  registry: ProjectRegistry,
  syncManager: RepoSyncManager,
): McpServer {
  const server = new McpServer({
    name: config.server.name,
    version: "0.1.0",
  });

  const fileAdapter = new FileAdapter(config);
  const probeAdapter = new ProbeAdapter(config);
  const grepAdapter = new GrepAdapter(config);
  const gitAdapter = new GitAdapter(config);
  const enabled = new Set<ToolName>(config.tools.enabled);

  if (enabled.has("list_projects")) {
    server.registerTool(
      "list_projects",
      {
        title: "List Projects",
        description: "List configured SourceScout projects and their last known sync state.",
        inputSchema: z.object({
          include_disabled: z.boolean().optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(() => {
          const includeDisabled =
            input.include_disabled === true || process.env.SHOW_DISABLED_PROJECTS === "true";
          return {
            projects: registry.list(includeDisabled).map((project) => ({
              id: project.config.id,
              name: project.config.name,
              description: project.config.description,
              branch: project.config.branch,
              status: project.state.status,
              last_sync_at: project.state.last_sync_at,
              last_error: project.state.last_error,
              current_head: project.state.current_head,
            })),
          };
        }),
    );
  }

  if (enabled.has("project_overview")) {
    server.registerTool(
      "project_overview",
      {
        title: "Project Overview",
        description: "Return a compact overview of a project: head, top-level paths, file count, and common extensions.",
        inputSchema: z.object({
          project_id: z.string(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ project_id }) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(project_id);
          return fileAdapter.overview(project);
        }),
    );
  }

  if (enabled.has("search_code")) {
    server.registerTool(
      "search_code",
      {
        title: "Search Code",
        description: "Semantic code search using ElasticSearch-style queries. Returns ranked code snippets. Use extract_code with returned file paths and line numbers to see full function/class context. ALWAYS use this tool instead of grep when searching for code in source files.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Configured SourceScout project ID. Replaces Probe's absolute path parameter; commands run from the project's local root."),
          query: z
            .string()
            .min(1)
            .describe('ElasticSearch query syntax. Use explicit AND/OR operators and parentheses for grouping. For exact matches, wrap terms in quotes. Examples: "functionName" (exact match), (error AND handler), ("getUserId" AND NOT deprecated).'),
          path: z
            .string()
            .optional()
            .describe("Optional file or directory path inside the project to search. Relative to the configured project root."),
          language: z
            .string()
            .optional()
            .describe("Programming language to limit search to specific file extensions."),
          maxResults: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Maximum number of results to return."),
          maxTokens: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Maximum total tokens in code content to return."),
          exact: z
            .boolean()
            .optional()
            .default(false)
            .describe('Default (false) enables stemming and keyword splitting for exploratory search - "getUserData" matches "get", "user", "data", etc. Set true for precise symbol lookup where "getUserData" matches only "getUserData". Use true when you know the exact symbol name.'),
          strictElasticSyntax: z
            .boolean()
            .optional()
            .default(false)
            .describe("Enforce strict ElasticSearch query syntax (require explicit AND/OR operators and quotes for exact matches)."),
          allowTests: z
            .boolean()
            .optional()
            .describe("Allow test files and test code blocks in search results."),
          session: z
            .string()
            .optional()
            .describe("Session ID for result caching and pagination. Pass the session ID from a previous search to get additional results. Results already shown in a session are automatically excluded. Omit for a fresh search."),
          reranker: z
            .enum(["bm25", "tfidf", "hybrid", "hybrid2"])
            .optional()
            .describe("Ranking algorithm for search results."),
          format: z
            .enum(["markdown", "plain", "json", "xml", "outline", "outline-xml"])
            .optional()
            .default("json")
            .describe("Output format for search results."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return probeAdapter.searchCode(project, input);
        }),
    );
  }

  if (enabled.has("query_code")) {
    server.registerTool(
      "query_code",
      {
        title: "Query Code",
        description: "Search code using AST patterns for precise structural matching. Use this for finding specific code structures such as functions, classes, calls, or declarations regardless of formatting.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Configured SourceScout project ID. Replaces Probe's absolute path parameter; commands run from the project's local root."),
          pattern: z
            .string()
            .min(1)
            .describe('AST pattern to search for. Example: "fn $NAME() { $$$BODY }".'),
          path: z
            .string()
            .optional()
            .describe("Optional file or directory path inside the project to search. Relative to the configured project root."),
          language: z
            .string()
            .optional()
            .describe("Programming language to use for parsing (auto-detected if not specified)."),
          ignore: z
            .array(z.string().min(1))
            .optional()
            .describe("Custom patterns to ignore in addition to .gitignore and common patterns."),
          allowTests: z
            .boolean()
            .optional()
            .describe("Allow test files in search results."),
          maxResults: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Maximum number of results to return."),
          withContext: z
            .boolean()
            .optional()
            .describe("Include owning source-block context in JSON output."),
          format: z
            .enum(["markdown", "plain", "json", "xml", "color", "outline-xml"])
            .optional()
            .default("json")
            .describe("Output format for query results."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return probeAdapter.queryCode(project, input);
        }),
    );
  }

  if (enabled.has("extract_code")) {
    server.registerTool(
      "extract_code",
      {
        title: "Extract Code",
        description: "Extract code blocks from files using tree-sitter AST parsing. Typically used after search_code to expand on search results and see complete code blocks. Each file path can include optional line numbers or symbol names to extract specific code blocks.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Configured SourceScout project ID. Replaces Probe's absolute path parameter; commands run from the project's local root."),
          files: z
            .array(z.string().min(1))
            .min(1)
            .describe("Files and lines or symbols to extract from: src/file.rs:10, src/file.rs:10-20, src/file.rs#func_name. Paths are relative to the configured project root."),
          allowTests: z
            .boolean()
            .optional()
            .describe("Allow test files and test code blocks in results (disabled by default)."),
          contextLines: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .default(0)
            .describe("Number of context lines to include before and after the extracted block when AST parsing fails to find a suitable node."),
          format: z
            .enum(["markdown", "plain", "json"])
            .optional()
            .default("markdown")
            .describe("Output format for the extracted code."),
          timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout for the extract operation in seconds (default: 30)."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return probeAdapter.extractCode(project, input);
        }),
    );
  }

  if (enabled.has("list_symbols")) {
    server.registerTool(
      "list_symbols",
      {
        title: "List Symbols",
        description: "List symbols (functions, structs, classes, constants, etc.) in files. Provides a table-of-contents view using tree-sitter AST parsing with line numbers and nesting.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Configured SourceScout project ID. Commands run from the project's local root."),
          files: z
            .array(z.string().min(1))
            .min(1)
            .describe("Files to list symbols from. Paths are relative to the configured project root."),
          allowTests: z
            .boolean()
            .optional()
            .describe("Include test functions/methods."),
          format: z
            .enum(["text", "json"])
            .optional()
            .default("json")
            .describe("Output format for symbols."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return probeAdapter.listSymbols(project, input);
        }),
    );
  }

  if (enabled.has("grep")) {
    server.registerTool(
      "grep",
      {
        title: "Grep",
        description: "Standard grep-style search. Line numbers are shown by default. For code files, use search_code instead.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Configured SourceScout project ID. Commands run from the project's local root."),
          pattern: z
            .string()
            .min(1)
            .describe("Regular expression pattern to search for."),
          paths: z
            .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
            .describe("Path or array of paths to search in. Paths are relative to the configured project root."),
          ignoreCase: z
            .boolean()
            .optional()
            .default(false)
            .describe("Case-insensitive search."),
          count: z
            .boolean()
            .optional()
            .default(false)
            .describe("Only show count of matches per file instead of the matches."),
          context: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Number of lines of context to show before and after each match."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return grepAdapter.grep(project, input);
        }),
    );
  }

  if (enabled.has("read_file")) {
    server.registerTool(
      "read_file",
      {
        title: "Read File",
        description: "Read a file by line range and return numbered lines.",
        inputSchema: z.object({
          project_id: z.string(),
          path: z.string().min(1),
          start_line: z.number().int().positive().optional(),
          end_line: z.number().int().positive().optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return fileAdapter.readFile(project, input);
        }),
    );
  }

  if (enabled.has("list_files")) {
    server.registerTool(
      "list_files",
      {
        title: "List Files",
        description: "List tracked files with optional path and glob filtering.",
        inputSchema: z.object({
          project_id: z.string(),
          path: z.string().optional(),
          glob: z.string().optional(),
          max_results: z.number().int().positive().optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return fileAdapter.listFiles(project, input);
        }),
    );
  }

  if (enabled.has("git_query")) {
    server.registerTool(
      "git_query",
      {
        title: "Git Query",
        description: gitQueryDescription,
        inputSchema: z
          .object({
            project_id: z.string(),
            operation: gitOperationSchema,
          })
          .passthrough(),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (input) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(input.project_id);
          return gitAdapter.query(project, input);
        }),
    );
  }

  return server;
}

async function toolResponse(fn: () => unknown | Promise<unknown>): Promise<any> {
  try {
    const data = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      structuredContent: toStructuredContent(data),
    };
  } catch (error) {
    const data =
      error instanceof SourceScoutError
        ? {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          }
        : {
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          };
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
}

function toStructuredContent(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}
