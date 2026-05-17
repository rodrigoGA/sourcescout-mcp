import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { ProjectRegistry } from "./projectRegistry.js";
import { RepoSyncManager } from "./repoSyncManager.js";
import { buildMcpServer } from "./mcpTools.js";
import { startHttpServer } from "./httpServer.js";

async function main(): Promise<void> {
  process.env.PATH = `${path.resolve("node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`;

  const config = await loadConfig();
  await mkdir(config.workspace.root, { recursive: true });
  await mkdir(config.workspace.state_path, { recursive: true });

  const registry = await ProjectRegistry.create(config);
  const syncManager = new RepoSyncManager(config, registry);
  const httpServer = await startHttpServer({
    config,
    registry,
    syncManager,
    createMcpServer: () => buildMcpServer(config, registry, syncManager),
  });

  syncManager.startStartupSync();
  console.log(`${config.server.name} listening on :${config.server.port}`);

  const shutdown = async () => {
    await httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
