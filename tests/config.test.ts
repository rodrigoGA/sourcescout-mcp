import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults and project config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sourcescout-config-"));
    const configPath = path.join(dir, "projects.yml");
    await writeFile(
      configPath,
      `
projects:
  - id: app
    name: App
    repo_url: git@example.com:org/app.git
`,
      "utf8",
    );

    const config = await loadConfig(configPath);
    expect(config.server.name).toBe("SourceScout MCP");
    expect(config.projects[0]?.branch).toBe("main");
    expect(config.limits.max_file_lines).toBe(60000);
  });
});
