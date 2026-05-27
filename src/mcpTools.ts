import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppConfig, ToolName } from "./types.js";
import { SourceScoutError } from "./types.js";
import { ProjectRegistry } from "./projectRegistry.js";
import { RepoSyncManager } from "./repoSyncManager.js";
import { ShellAdapter } from "./adapters/shellAdapter.js";
import { VERSION } from "./version.js";

export function buildMcpServer(
  config: AppConfig,
  registry: ProjectRegistry,
  syncManager: RepoSyncManager,
): McpServer {
  const server = new McpServer({
    name: config.server.name,
    version: VERSION,
  });

  const shellAdapter = new ShellAdapter(config);
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

  if (enabled.has("code_inspect_shell")) {
    server.registerTool(
      "code_inspect_shell",
      {
        title: "Code Inspect Shell",
        description:
          "Run a bounded read-only inspection shell command from the configured project's root directory. Use this to inspect source code, understand behavior, trace implementations, measure code composition, and review Git history without modifying the checkout. Useful commands include ls, tree, find, cloc, rg --files, rg \"pattern\", grep -R, git grep, git status, git diff, git log, git blame, cat, sed -n 'X,Yp', head, and tail. Output is combined stdout/stderr text with exit status metadata.",
        inputSchema: z.object({
          project_id: z.string().describe("Configured SourceScout project ID."),
          command: z
            .string()
            .min(1)
            .describe(
              "Command executed with /bin/sh -lc from the project root. Prefer read-only inspection commands such as rg, git grep, git log, git diff, find, tree, cloc, cat, sed -n, head, and tail.",
            ),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ project_id, command }) =>
        toolResponse(async () => {
          const project = await syncManager.ensureProjectFresh(project_id);
          return shellAdapter.inspect(project, command);
        }),
    );
  }

  return server;
}

async function toolResponse(fn: () => unknown | Promise<unknown>): Promise<any> {
  try {
    const data = await fn();
    if (typeof data === "string") {
      return {
        content: [{ type: "text" as const, text: data }],
      };
    }
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
