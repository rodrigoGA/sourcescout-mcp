import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitAuthEnv, prepareProjectGitAuth } from "../src/gitAuth.js";
import { testConfig } from "./helpers.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("prepareProjectGitAuth", () => {
  it("configures Git credential helper from per-project mounted basic-auth Secret", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-git-auth-"));
    const secretPath = path.join(root, "secret");
    await mkdir(secretPath);
    await writeFile(path.join(secretPath, "username"), "rgonzalez", "utf8");
    await writeFile(path.join(secretPath, "password"), "glpat-token", "utf8");

    const config = testConfig({
      workspace: {
        root: path.join(root, "repos"),
        state_path: path.join(root, "state"),
      },
      projects: [
        {
          id: "app",
          name: "App",
          git: {
            url: "https://gitlab.easyap.com/easyap/app.git",
            auth: {
              type: "httpsToken",
              path: secretPath,
            },
          },
          branch: "master",
          enabled: true,
        },
      ],
    });

    await prepareProjectGitAuth(config);

    const env = gitAuthEnv(config.projects[0]!);
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("credential.helper");
    expect(env.GIT_CONFIG_VALUE_0).toContain("store --file ");

    const credentialsPath = env.GIT_CONFIG_VALUE_0?.replace("store --file ", "");
    expect(credentialsPath).toBeTruthy();
    await expect(readFile(credentialsPath as string, "utf8")).resolves.toBe(
      "https://rgonzalez:glpat-token@gitlab.easyap.com\n",
    );
  });
});
