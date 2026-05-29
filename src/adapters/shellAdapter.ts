import type { AppConfig, RegisteredProject, ShellCommandResult } from "../types.js";
import { SourceScoutError } from "../types.js";
import { runShellCommand } from "../shellRunner.js";

export class ShellAdapter {
  constructor(private readonly config: AppConfig) {}

  async inspect(project: RegisteredProject, command: string): Promise<string> {
    const result = await runShellCommand(command, {
      cwd: project.localPath,
      readonlyUser: this.config.shell.readonly_user,
      timeoutMs: this.config.limits.command_timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    logShellResult(project, command, this.config.shell.readonly_user, result);

    if (result.exitCode === null) {
      throw new SourceScoutError("SHELL_RUNNER_FAILED", result.output || "failed to start shell runner", 500, {
        command: result.command,
        args: result.args,
        cwd: result.cwd,
      });
    }

    return formatShellResult(result);
  }

  async healthCheck(cwd: string): Promise<Record<string, unknown>> {
    const result = await runShellCommand(":", {
      cwd,
      readonlyUser: this.config.shell.readonly_user,
      timeoutMs: 5000,
      maxOutputBytes: 10000,
    });

    return {
      available: result.exitCode === 0 && !result.timedOut,
      readonly_user: this.config.shell.readonly_user ?? null,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      timed_out: result.timedOut,
      sanitized: result.sanitized,
      ...(result.output ? { output: result.output.trim() } : {}),
    };
  }
}

function formatShellResult(result: ShellCommandResult): string {
  const metadata = formatShellMetadata(result);
  if (result.output.length === 0) {
    return `${metadata}\n`;
  }

  const output = result.output.endsWith("\n") ? result.output : `${result.output}\n`;
  return `${metadata}\nOutput:\n${output}`;
}

function formatShellMetadata(result: ShellCommandResult): string {
  const lines = [`Exit code: ${result.exitCode ?? "null"}`];
  if (result.timedOut) {
    lines.push("Timed out: true", `Wall time: ${formatSeconds(result.durationMs)} seconds`);
  }
  if (result.truncated) {
    lines.push("Truncated: true");
  }
  if (result.sanitized) {
    lines.push("Sanitized: true");
  }
  if (result.output.length > 0) {
    lines.push(`Output lines: ${countOutputLines(result.output)}`);
  }
  return lines.join("\n");
}

function countOutputLines(output: string): number {
  if (output.length === 0) {
    return 0;
  }
  const trailingNewline = output.endsWith("\n") ? 1 : 0;
  return output.split("\n").length - trailingNewline;
}

function formatSeconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(2);
}

function logShellResult(
  project: RegisteredProject,
  command: string,
  readonlyUser: string | undefined,
  result: ShellCommandResult,
): void {
  console.log(
    JSON.stringify({
      event: "code_inspect_shell",
      project_id: project.config.id,
      cwd: result.cwd,
      command,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      timed_out: result.timedOut,
      truncated: result.truncated,
      sanitized: result.sanitized,
      readonly_user: readonlyUser ?? null,
    }),
  );
}
