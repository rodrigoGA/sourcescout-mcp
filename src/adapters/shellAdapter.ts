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
  let output = result.output;
  if (result.truncated) {
    output = appendLine(output, "[SourceScout: output truncated]");
  }

  const body = output.length === 0 ? "" : `${output}${output.endsWith("\n") ? "" : "\n"}`;
  const footer = [
    "[SourceScout shell status]",
    `exit_code=${result.exitCode ?? "null"}`,
    `duration_ms=${result.durationMs}`,
    `timed_out=${result.timedOut}`,
    `truncated=${result.truncated}`,
    `sanitized=${result.sanitized}`,
  ].join("\n");

  return `${body}${footer}\n`;
}

function appendLine(output: string, line: string): string {
  return `${output}${output.endsWith("\n") || output.length === 0 ? "" : "\n"}${line}`;
}
