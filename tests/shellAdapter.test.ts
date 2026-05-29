import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellAdapter } from "../src/adapters/shellAdapter.js";
import { runShellCommand } from "../src/shellRunner.js";
import type { RegisteredProject } from "../src/types.js";
import { testConfig } from "./helpers.js";

const originalPath = process.env.PATH;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
});

describe("ShellAdapter", () => {
  it("executes commands from the project root and returns shell text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "pwd");

    expect(output).toContain(`Exit code: 0\nOutput lines: 1\nOutput:\n${root}\n`);
    expect(output).not.toContain("Wall time:");
    expect(output).not.toContain("Timed out: false");
    expect(output).not.toContain("Truncated: false");
    expect(output).not.toContain("Sanitized: false");
  });

  it("keeps non-zero shell exit codes as normal tool output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "printf 'before\\n'; exit 7");

    expect(output).toContain("Exit code: 7\nOutput lines: 1\nOutput:\nbefore\n");
  });

  it("omits output metadata when the shell produces no output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "exit 1");

    expect(output).toBe("Exit code: 1\n");
    expect(output).not.toContain("Output:");
    expect(output).not.toContain("Output lines:");
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
    expect(output).toContain("Exit code: 0\nTruncated: true\nOutput lines: 1\nOutput:\nabcde\n");
  });

  it("escapes NUL and non-printable control characters before returning text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    const output = await adapter.inspect(project(root), "printf 'a\\000b\\001\\t\\n'");

    expect(output).toContain("a\\0b\\x01\t\n");
    expect(output).not.toContain("\0");
    expect(output).toContain("Sanitized: true\n");
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

  it("reports timeout metadata before shell output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(
      testConfig({
        limits: {
          max_tool_output_bytes: 1000,
          command_timeout_seconds: 1,
        },
      }),
    );

    const output = await adapter.inspect(project(root), "printf 'before\\n'; sleep 2");

    expect(output).toMatch(
      /^Exit code: 143\nTimed out: true\nWall time: \d+\.\d{2} seconds\nOutput lines: 1\nOutput:\nbefore\n$/,
    );
  });

  it("logs shell command metadata without output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-shell-"));
    const adapter = new ShellAdapter(testConfig());

    await adapter.inspect(project(root), "printf 'ok\\n'");

    expect(console.log).toHaveBeenCalledTimes(1);
    const event = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string);
    expect(event).toMatchObject({
      event: "code_inspect_shell",
      project_id: "app",
      cwd: root,
      command: "printf 'ok\\n'",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      sanitized: false,
      readonly_user: null,
    });
    expect(event.duration_ms).toEqual(expect.any(Number));
    expect(event.output).toBeUndefined();
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
