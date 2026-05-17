import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileAdapter } from "../src/adapters/fileAdapter.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

describe("FileAdapter", () => {
  it("reads numbered line ranges", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-file-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.ts"), "one\ntwo\nthree\n", "utf8");

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

    const adapter = new FileAdapter(testConfig());
    const result = await adapter.readFile(project, {
      path: "src/app.ts",
      start_line: 2,
      end_line: 3,
    });

    expect(result.content).toBe("2: two\n3: three");
    expect(result.total_lines).toBe(4);
  });
});
