import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitAdapter } from "../src/adapters/gitAdapter.js";
import { runCommand } from "../src/commandRunner.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

describe("GitAdapter", () => {
  it("returns git log commits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-git-"));
    await must("git", ["init"], root);
    await must("git", ["config", "user.email", "test@example.com"], root);
    await must("git", ["config", "user.name", "Test User"], root);
    await writeFile(path.join(root, "app.txt"), "hello\n", "utf8");
    await must("git", ["add", "app.txt"], root);
    await must("git", ["commit", "-m", "initial"], root);

    const project: RegisteredProject = {
      config: {
        id: "app",
        name: "App",
        branch: "main",
        enabled: true,
        local_path: root,
      },
      localPath: root,
      managedClone: false,
      state: {
        status: "ready",
        last_sync_at: null,
        last_error: null,
        local_path: root,
        current_head: null,
      },
    };

    const adapter = new GitAdapter(testConfig());
    const result = (await adapter.query(project, { operation: "log", limit: 5 })) as {
      commits: Array<{ subject: string; author_email: string }>;
    };

    expect(result.commits[0]?.subject).toBe("initial");
    expect(result.commits[0]?.author_email).toBe("test@example.com");
  });
});

async function must(command: string, args: string[], cwd: string): Promise<void> {
  const result = await runCommand(command, args, {
    cwd,
    timeoutMs: 30000,
    maxOutputBytes: 100000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
