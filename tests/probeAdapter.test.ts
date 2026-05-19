import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProbeAdapter } from "../src/adapters/probeAdapter.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

describe("ProbeAdapter", () => {
  it("parses Probe JSON output with informational prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-probe-"));
    const fakeProbe = path.join(root, "probe");
    await writeFile(
      fakeProbe,
      `#!/bin/sh
echo 'Using BM25 ranking'
echo '{"results":[{"file":"src/index.ts","lines":[1,2]}]}'
`,
      "utf8",
    );
    await chmod(fakeProbe, 0o755);

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

    const adapter = new ProbeAdapter(testConfig({ probe: { binary: fakeProbe } }));
    const result = (await adapter.searchCode(project, { query: "hello" })) as {
      result: { results: Array<{ file: string }> };
    };

    expect(result.result.results[0]?.file).toBe("src/index.ts");
  });

  it("maps Probe-style camelCase options to CLI flags", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-probe-"));
    const fakeProbe = path.join(root, "probe");
    const argsFile = path.join(root, "args.txt");
    await writeFile(
      fakeProbe,
      `#!/bin/sh
printf '%s\n' "$@" > ${JSON.stringify(argsFile)}
echo '{"results":[]}'
`,
      "utf8",
    );
    await chmod(fakeProbe, 0o755);

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

    const adapter = new ProbeAdapter(testConfig({ probe: { binary: fakeProbe } }));
    await adapter.searchCode(project, {
      query: "auth AND login",
      path: "src",
      maxResults: 7,
      maxTokens: 900,
      allowTests: true,
      strictElasticSyntax: true,
      session: "abc",
    });

    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toContain("--max-results");
    expect(args).toContain("7");
    expect(args).toContain("--max-tokens");
    expect(args).toContain("900");
    expect(args).toContain("--allow-tests");
    expect(args).toContain("--strict-elastic-syntax");
    expect(args).toContain("--session");
    expect(args).toContain("abc");
  });

  it("applies Probe MCP search defaults when callers omit result and token limits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-probe-"));
    const fakeProbe = path.join(root, "probe");
    const argsFile = path.join(root, "args.txt");
    await writeFile(
      fakeProbe,
      `#!/bin/sh
printf '%s\n' "$@" > ${JSON.stringify(argsFile)}
echo '{"results":[]}'
`,
      "utf8",
    );
    await chmod(fakeProbe, 0o755);

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

    const adapter = new ProbeAdapter(testConfig({ probe: { binary: fakeProbe } }));
    await adapter.searchCode(project, { query: "auth" });

    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toContain("--max-results");
    expect(args).toContain("20");
    expect(args).toContain("--max-tokens");
    expect(args).toContain("8000");
  });
});
