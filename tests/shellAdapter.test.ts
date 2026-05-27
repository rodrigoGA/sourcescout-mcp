import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShellAdapter } from "../src/adapters/shellAdapter.js";
import { runShellCommand } from "../src/shellRunner.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe("ShellAdapter", () => {
  it("executes commands from the project root and returns shell text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "pwd");

    expect(output).toContain(`${root}\n`);
    expect(output).toContain("[SourceScout shell status]\nexit_code=0\n");
  });

  it("keeps non-zero shell exit codes as normal tool output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "printf 'before\\n'; exit 7");

    expect(output).toContain("before\n");
    expect(output).toContain("exit_code=7\n");
  });

  it("truncates combined stdout and stderr using max_tool_output_bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(
      testConfig({
        limits: {
          max_tool_output_bytes: 5,
          command_timeout_seconds: 300,
        },
      }),
    );

    const output = await adapter.inspect(project(root), "printf abc; printf def >&2");

    expect(output).toContain("abcde");
    expect(output).toContain("[SourceScout: output truncated]");
    expect(output).toContain("truncated=true\n");
  });

  it("escapes NUL and non-printable control characters before returning text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "printf 'a\\000b\\001\\t\\n'");

    expect(output).toContain("a\\0b\\x01\t\n");
    expect(output).not.toContain("\0");
    expect(output).toContain("sanitized=true\n");
  });

  it("terminates the shell process group on timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));

    const result = await runShellCommand("sleep 5", {
      cwd: root,
      timeoutMs: 50,
      maxOutputBytes: 1000,
    });

    expect(result.timedOut).toBe(true);
  });

  it("uses sudo to run as the configured read-only user", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const fakeBin = path.join(root, "bin");
    const callsFile = path.join(root, "sudo-args.txt");
    await mkdir(fakeBin);
    const fakeSudo = path.join(fakeBin, "sudo");
    await writeFile(
      fakeSudo,
      `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(callsFile)}
while [ "$1" != "--" ]; do
  shift
done
shift
exec "$@"
`,
      "utf8",
    );
    await chmod(fakeSudo, 0o755);
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ""}`;

    const adapter = new ShellAdapter(testConfig({ shell: { readonly_user: "sourcescout-readonly" } }));
    const output = await adapter.inspect(project(root), "printf 'ok\\n'");

    expect(output).toContain("ok\n");
    await expect(readFile(callsFile, "utf8")).resolves.toBe(
      "-n\n-u\nsourcescout-readonly\n--\n/bin/sh\n-lc\nprintf 'ok\\n'\n",
    );
  });
});

function project(localPath: string): RegisteredProject {
  return {
    config: {
      id: "app",
      name: "App",
      branch: "main",
      local_path: localPath,
      enabled: true,
    },
    localPath,
    managedClone: false,
    state: {
      status: "ready",
      last_sync_at: null,
      last_error: null,
      local_path: localPath,
      current_head: null,
    },
  };
}
