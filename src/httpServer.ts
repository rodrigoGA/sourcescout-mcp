import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AppConfig } from "./types.js";
import { ProjectRegistry } from "./projectRegistry.js";
import { RepoSyncManager } from "./repoSyncManager.js";
import { runCommand } from "./commandRunner.js";
import { ShellAdapter } from "./adapters/shellAdapter.js";
import { VERSION } from "./version.js";

export interface HttpServerContext {
  config: AppConfig;
  registry: ProjectRegistry;
  syncManager: RepoSyncManager;
  createMcpServer: () => McpServer;
}

export function startHttpServer(context: HttpServerContext): Promise<{ close: () => Promise<void>; port: number }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/live") {
        return sendJson(res, 200, { status: "ok" });
      }
      if (req.method === "GET" && url.pathname === "/ready") {
        const readiness = getReadiness(context);
        return sendJson(res, readiness.ready ? 200 : 503, readiness.body);
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, await getHealth(context));
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }
      if (url.pathname === "/mcp") {
        if (!isAuthorized(context.config, req)) {
          return sendJson(res, 401, { error: "unauthorized" });
        }
        const mcpServer = context.createMcpServer();
        const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void mcpServer.close();
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(context.config.server.port, () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : context.config.server.port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

function isAuthorized(config: AppConfig, req: IncomingMessage): boolean {
  if (!config.auth.enabled) {
    return true;
  }
  const expected = process.env[config.auth.token_env];
  if (!expected) {
    return false;
  }
  const header = req.headers.authorization;
  return header === `Bearer ${expected}`;
}

function getReadiness(context: HttpServerContext): { ready: boolean; body: Record<string, unknown> } {
  const projects = context.registry.list(false);
  const projectsReady = projects.filter((project) => project.state.status === "ready").length;
  const projectsError = projects.filter((project) => project.state.status === "error").length;
  const projectsTotal = projects.length;
  let ready = true;
  let reason: string | undefined;

  if (context.config.readiness.mode === "all_projects" && projectsReady !== projectsTotal) {
    ready = false;
    reason = "not_all_projects_ready";
  } else if (context.config.readiness.mode === "one_project" && projectsReady < 1) {
    ready = false;
    reason = "no_project_ready";
  }

  return {
    ready,
    body: {
      status: ready ? "ready" : "not_ready",
      ...(reason ? { reason } : {}),
      projects_total: projectsTotal,
      projects_ready: projectsReady,
      projects_error: projectsError,
      readiness_mode: context.config.readiness.mode,
      startup_sync_in_progress: context.syncManager.isStartupSyncInProgress(),
    },
  };
}

async function getHealth(context: HttpServerContext): Promise<Record<string, unknown>> {
  const shellAdapter = new ShellAdapter(context.config);
  const [git, shell] = await Promise.all([
    runCommand("git", ["--version"], {
      timeoutMs: 5000,
      maxOutputBytes: 10000,
    }),
    shellAdapter.healthCheck(context.config.workspace.root),
  ]);

  const projects: Record<string, unknown> = {};
  for (const project of context.registry.list(true)) {
    projects[project.config.id] = {
      status: project.state.status,
      last_sync_at: project.state.last_sync_at,
      last_error: project.state.last_error,
      current_head: project.state.current_head,
    };
  }

  return {
    status: "ok",
    version: VERSION,
    git: {
      available: git.exitCode === 0,
      version: git.stdout.trim() || git.stderr.trim(),
    },
    shell,
    projects,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,mcp-session-id,mcp-protocol-version",
  };
}
