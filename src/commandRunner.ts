import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
}

export function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<CommandResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1000).unref();
    }, options.timeoutMs);

    const collect = (chunks: Buffer[], currentBytes: number, chunk: Buffer): number => {
      const remaining = options.maxOutputBytes - currentBytes;
      if (remaining <= 0) {
        truncated = true;
        return currentBytes + chunk.length;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        truncated = true;
      } else {
        chunks.push(chunk);
      }
      return currentBytes + chunk.length;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes = collect(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = collect(stderrChunks, stderrBytes, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        timedOut,
        truncated,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
