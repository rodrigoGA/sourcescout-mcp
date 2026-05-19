import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectRegistry } from "../src/projectRegistry.js";
import { RepoSyncManager } from "../src/repoSyncManager.js";
import { testConfig } from "./helpers.js";

describe("RepoSyncManager", () => {
  it("runs stale checkout sync in the background without queuing duplicate syncs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-sync-"));
    const fakeBin = path.join(root, "bin");
    const repoPath = path.join(root, "repos", "app");
    const statePath = path.join(root, "state");
    const callsFile = path.join(root, "git-calls.txt");
    await mkdir(path.join(repoPath, ".git"), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const fakeGit = path.join(fakeBin, "git");
    await writeFile(
      fakeGit,
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
  echo true
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  echo abc123
  exit 0
fi
if [ "$1" = "fetch" ]; then
  sleep 0.2
fi
exit 0
`,
      "utf8",
    );
    await chmod(fakeGit, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ""}`;
    const baseConfig = testConfig();
    const config = testConfig({
      workspace: {
        ...baseConfig.workspace,
        root: path.join(root, "repos"),
        state_path: statePath,
        pull_ttl_seconds: 0,
      },
      projects: [
        {
          id: "app",
          name: "App",
          git: {
            url: "git@example.com:org/app.git",
          },
          branch: "main",
          enabled: true,
        },
      ],
    });

    try {
      const registry = await ProjectRegistry.create(config);
      await registry.updateState("app", {
        status: "ready",
        last_sync_at: "2020-01-01T00:00:00.000Z",
      });
      const manager = new RepoSyncManager(config, registry);

      const [first, second] = await Promise.all([
        manager.ensureProjectFresh("app"),
        manager.ensureProjectFresh("app"),
      ]);
      await manager.syncProject("app", { startup: false });

      expect(first.config.id).toBe("app");
      expect(second.config.id).toBe("app");
      const calls = await readFile(callsFile, "utf8");
      expect(calls.match(/^fetch /gm)).toHaveLength(1);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
