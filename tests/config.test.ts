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
    git:
      url: git@example.com:org/app.git
`,
      "utf8",
    );

    const config = await loadConfig(configPath);
    expect(config.server.name).toBe("SourceScout MCP");
    expect(config.projects[0]?.branch).toBe("main");
    expect(config.tools.enabled).toEqual(["list_projects", "code_inspect_shell"]);
    expect(config.shell.readonly_user).toBeUndefined();
    expect(config.limits.max_tool_output_bytes).toBe(8000000);
  });

  it("loads per-project Git auth config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sourcescout-config-"));
    const configPath = path.join(dir, "projects.yml");
    await writeFile(
      configPath,
      `
projects:
  - id: app
    name: App
    git:
      url: https://gitlab.example.com/org/app.git
      auth:
        type: httpsToken
        path: /run/secrets/sourcescout/git-auth/gitlab
`,
      "utf8",
    );

    const config = await loadConfig(configPath);
    expect(config.projects[0]?.git?.auth).toEqual({
      type: "httpsToken",
      path: "/run/secrets/sourcescout/git-auth/gitlab",
    });
  });
});
