import { spawn } from "node:child_process";
import jsesc from "jsesc";
import type { ShellCommandResult } from "./types.js";

export interface RunShellCommandOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  readonlyUser?: string;
  env?: NodeJS.ProcessEnv;
}

export function runShellCommand(command: string, options: RunShellCommandOptions): Promise<ShellCommandResult> {
  const startedAt = Date.now();
  const invocation = shellInvocation(command, options.readonlyUser);

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      detached: true,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outputChunks: Buffer[] = [];
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let closed = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child.pid, "SIGTERM", () => child.kill("SIGTERM"));
      killTimer = setTimeout(() => {
        if (!closed) {
          signalProcessGroup(child.pid, "SIGKILL", () => child.kill("SIGKILL"));
        }
      }, 1000);
      killTimer.unref();
    }, options.timeoutMs);
    timer.unref();

    const collect = (chunk: Buffer): void => {
      const remaining = options.maxOutputBytes - outputBytes;
      if (remaining <= 0) {
        truncated = true;
        outputBytes += chunk.length;
        return;
      }

      if (chunk.length > remaining) {
        outputChunks.push(chunk.subarray(0, remaining));
        truncated = true;
      } else {
        outputChunks.push(chunk);
      }
      outputBytes += chunk.length;
    };

    const finish = (exitCode: number | null, extraOutput?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }

      const rawOutput = Buffer.concat(outputChunks).toString("utf8");
      const combinedOutput = extraOutput ? appendLine(rawOutput, extraOutput) : rawOutput;
      const sanitizedOutput = sanitizeText(combinedOutput);
      const boundedOutput = truncateUtf8Text(sanitizedOutput.text, options.maxOutputBytes);
      resolve({
        command: invocation.command,
        args: invocation.args,
        cwd: options.cwd,
        exitCode,
        output: boundedOutput.text,
        sanitized: sanitizedOutput.sanitized,
        timedOut,
        truncated: truncated || boundedOutput.truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (exitCode) => {
      closed = true;
      finish(exitCode);
    });
  });
}

function shellInvocation(command: string, readonlyUser?: string): { command: string; args: string[] } {
  if (readonlyUser) {
    return {
      command: "sudo",
      args: ["-n", "-u", readonlyUser, "--", "/bin/sh", "-lc", command],
    };
  }

  return {
    command: "/bin/sh",
    args: ["-lc", command],
  };
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals, fallback: () => void): void {
  if (!pid) {
    fallback();
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    fallback();
  }
}

function appendLine(output: string, line: string): string {
  return `${output}${output.endsWith("\n") || output.length === 0 ? "" : "\n"}${line}`;
}

function sanitizeText(text: string): { text: string; sanitized: boolean } {
  const unsafeControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  let sanitized = false;
  const output = text.replace(unsafeControlCharacters, (char) => {
    sanitized = true;
    return jsesc(char, { quotes: "double", wrap: false });
  });
  return { text: output, sanitized };
}

function truncateUtf8Text(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }

  return {
    text: Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}
