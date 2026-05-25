import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProbeAdapter } from "../src/adapters/probeAdapter.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

describe("ProbeAdapter", () => {
  it("returns raw Probe search output without a SourceScout envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-probe-"));
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
    const result = await adapter.searchCode(project, { query: "hello" });

    expect(result).toBe(`<matches>
<file path="src/index.ts">
1 export const value = 1;
</file>
</matches>
`);
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
      nextPage: true,
    });

    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toContain("--format");
    expect(args).toContain("outline-xml");
    expect(args).toContain("--max-results");
    expect(args).toContain("7");
    expect(args).toContain("--max-tokens");
    expect(args).toContain("900");
    expect(args).toContain("--allow-tests");
    expect(args).toContain("--strict-elastic-syntax");
    expect(args).toContain("--session");
    expect(args).toContain("abc");
    expect(args).not.toContain("--next-page");
    expect(args).not.toContain("nextPage");
  });

  it("applies Probe MCP search defaults when callers omit search options", async () => {
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
    expect(args).toContain("--format");
    expect(args).toContain("outline-xml");
    expect(args).toContain("--max-results");
    expect(args).toContain("20");
    expect(args).toContain("--max-tokens");
    expect(args).toContain("8000");
    expect(args).not.toContain("--allow-tests");
    expect(args).toContain("--session");
    expect(args).toContain("new");
  });

  it("normalizes blank search sessions to Probe's new session marker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-probe-"));
    const fakeProbe = path.join(root, "probe");
    const argsFile = path.join(root, "args.txt");
    await writeFile(
      fakeProbe,
      `#!/bin/sh
printf '%s\n' "$@" > ${JSON.stringify(argsFile)}
echo '<matches />'
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
    await adapter.searchCode(project, { query: "auth", session: "  " });

    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toContain("--session");
    expect(args).toContain("new");
  });
});
