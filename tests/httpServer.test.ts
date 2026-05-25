import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { startHttpServer } from "../src/httpServer.js";
import { buildMcpServer } from "../src/mcpTools.js";
import { ProjectRegistry } from "../src/projectRegistry.js";
import { RepoSyncManager } from "../src/repoSyncManager.js";
import { testConfig } from "./helpers.js";

describe("HTTP MCP server", () => {
  it("handles concurrent stateless Streamable HTTP tool calls", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-http-"));
    const baseConfig = testConfig();
    const config = testConfig({
      server: { name: "SourceScout MCP", port: 0 },
      workspace: {
        ...baseConfig.workspace,
        root: path.join(root, "repos"),
        state_path: path.join(root, "state"),
      },
      projects: [],
    });
    const registry = await ProjectRegistry.create(config);
    const syncManager = new RepoSyncManager(config, registry);
    const httpServer = await startHttpServer({
      config,
      registry,
      syncManager,
      createMcpServer: () => {
        const server = buildMcpServer(config, registry, syncManager);
        server.registerTool(
          "delay_echo",
          {
            description: "Test tool that returns after a delay.",
            inputSchema: z.object({
              value: z.string(),
              delayMs: z.number().int().nonnegative(),
            }),
          },
          async ({ value, delayMs }) => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return { content: [{ type: "text" as const, text: value }] };
          },
        );
        return server;
      },
    });

    try {
      const url = `http://127.0.0.1:${httpServer.port}/mcp`;
      const [slow, fast] = await Promise.all([
        postMcp(url, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "delay_echo", arguments: { value: "slow", delayMs: 100 } },
        }),
        postMcp(url, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "delay_echo", arguments: { value: "fast", delayMs: 0 } },
        }),
      ]);

      expect(toolText(slow)).toBe("slow");
      expect(toolText(fast)).toBe("fast");
    } finally {
      await httpServer.close();
    }
  });

  it("returns raw Probe MCP-compatible search text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-http-"));
    const fakeProbe = path.join(root, "probe");
    await writeFile(
      fakeProbe,
      `#!/bin/sh
cat <<'EOF'
<matches>
<file path="src/index.ts">
1 export const value = 1;
</file>
</matches>
EOF
`,
      "utf8",
    );
    await chmod(fakeProbe, 0o755);

    const baseConfig = testConfig();
    const config = testConfig({
      server: { name: "SourceScout MCP", port: 0 },
      workspace: {
        ...baseConfig.workspace,
        root: path.join(root, "repos"),
        state_path: path.join(root, "state"),
      },
      probe: { binary: fakeProbe },
      projects: [
        {
          id: "app",
          name: "App",
          local_path: root,
          branch: "main",
          enabled: true,
        },
      ],
    });
    const registry = await ProjectRegistry.create(config);
    await registry.updateState("app", { status: "ready" });
    const syncManager = new RepoSyncManager(config, registry);
    const httpServer = await startHttpServer({
      config,
      registry,
      syncManager,
      createMcpServer: () => buildMcpServer(config, registry, syncManager),
    });

    try {
      const response = await postMcp(`http://127.0.0.1:${httpServer.port}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_code", arguments: { project_id: "app", query: "value" } },
      });

      expect(toolText(response)).toBe(`<matches>
<file path="src/index.ts">
1 export const value = 1;
</file>
</matches>
`);
      expect(response.result?.structuredContent).toBeUndefined();
    } finally {
      await httpServer.close();
    }
  });
});

async function postMcp(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length).trim())
      .filter(Boolean)
      .at(-1);
    expect(data).toBeTruthy();
    return JSON.parse(data!);
  }
  return JSON.parse(raw);
}

function toolText(response: any): string | undefined {
  return response.result?.content?.[0]?.text;
}
