import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, RegisteredProject } from "./types.js";
import { SourceScoutError } from "./types.js";
import { AsyncLock } from "./asyncLock.js";
import { runCommand } from "./commandRunner.js";
import { ProjectRegistry } from "./projectRegistry.js";

export class RepoSyncManager {
  private readonly locks = new Map<string, AsyncLock>();
  private readonly activeSyncs = new Map<string, Promise<void>>();
  private startupSyncInProgress = false;

  constructor(
    private readonly config: AppConfig,
    private readonly registry: ProjectRegistry,
  ) {}

  isStartupSyncInProgress(): boolean {
    return this.startupSyncInProgress;
  }

  startStartupSync(): void {
    if (!this.config.workspace.clone_on_startup && !this.config.workspace.pull_on_startup) {
      return;
    }

    this.startupSyncInProgress = true;
    void Promise.allSettled(
      this.registry
        .list(false)
        .map((project) => this.syncProject(project.config.id, { startup: true })),
    ).finally(() => {
      this.startupSyncInProgress = false;
    });
  }

  async ensureProjectFresh(projectId: string): Promise<RegisteredProject> {
    const project = this.registry.get(projectId);
    const ttlMs = this.config.workspace.pull_ttl_seconds * 1000;
    const lastSync = project.state.last_sync_at ? Date.parse(project.state.last_sync_at) : 0;
    const shouldSync = ttlMs === 0 || !lastSync || Date.now() - lastSync >= ttlMs || project.state.status === "missing";

    if (shouldSync) {
      const usableCheckout = await this.isUsableCheckout(project);
      const sync = this.syncProject(projectId, { startup: false });
      if (!usableCheckout) {
        await sync;
      }
    }

    const refreshed = this.registry.get(projectId);
    if (!["ready", "stale"].includes(refreshed.state.status)) {
      if (refreshed.state.status === "syncing" && (await this.isUsableCheckout(refreshed))) {
        return refreshed;
      }
      throw new SourceScoutError(
        "PROJECT_NOT_AVAILABLE",
        `project is not available: ${projectId}`,
        503,
        refreshed.state,
      );
    }
    return refreshed;
  }

  async syncProject(projectId: string, options: { startup: boolean }): Promise<void> {
    const active = this.activeSyncs.get(projectId);
    if (active) {
      return active;
    }

    const sync = this.runSyncProject(projectId, options).finally(() => {
      if (this.activeSyncs.get(projectId) === sync) {
        this.activeSyncs.delete(projectId);
      }
    });
    this.activeSyncs.set(projectId, sync);
    return sync;
  }

  private async runSyncProject(projectId: string, options: { startup: boolean }): Promise<void> {
    const lock = this.getLock(projectId);
    await lock.runExclusive(async () => {
      const project = this.registry.get(projectId);
      await this.registry.updateState(projectId, { status: "syncing", last_error: null });

      try {
        await this.syncProjectInternal(project, options);
        await this.registry.updateState(projectId, {
          status: "ready",
          last_sync_at: new Date().toISOString(),
          last_error: null,
          current_head: await this.getHead(project.localPath),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (await this.isUsableCheckout(project)) {
          await this.registry.updateState(projectId, {
            status: "stale",
            last_error: message,
            current_head: await this.getHead(project.localPath),
          });
          return;
        }
        await this.registry.updateState(projectId, {
          status: "error",
          last_error: message,
          current_head: null,
        });
      }
    });
  }

  private async syncProjectInternal(project: RegisteredProject, options: { startup: boolean }): Promise<void> {
    if (!project.managedClone) {
      await this.verifyExternalPath(project);
      if (options.startup && this.config.workspace.pull_on_startup && (await this.hasGit(project.localPath))) {
        await this.pullExisting(project);
      }
      return;
    }

    const exists = await this.pathExists(project.localPath);
    if (!exists) {
      if (!this.config.workspace.clone_on_startup && options.startup) {
        throw new SourceScoutError("PROJECT_MISSING", `managed clone missing: ${project.localPath}`, 503);
      }
      await this.clone(project);
      return;
    }

    if (!(await this.hasGit(project.localPath))) {
      if (this.config.workspace.reclone_on_sync_failure) {
        await rm(project.localPath, { recursive: true, force: true });
        await this.clone(project);
        return;
      }
      throw new SourceScoutError("PROJECT_INVALID", `project path is not a Git checkout: ${project.localPath}`, 503);
    }

    const shouldPull = !options.startup || this.config.workspace.pull_on_startup;
    if (!shouldPull) {
      return;
    }

    const pulled = await this.tryPull(project);
    if (pulled) {
      return;
    }

    if (this.config.workspace.reclone_on_sync_failure) {
      await rm(project.localPath, { recursive: true, force: true });
      await this.clone(project);
      return;
    }

    throw new SourceScoutError("PROJECT_SYNC_FAILED", `failed to sync project: ${project.config.id}`, 503);
  }

  private async verifyExternalPath(project: RegisteredProject): Promise<void> {
    const exists = await this.pathExists(project.localPath);
    if (!exists) {
      throw new SourceScoutError("PROJECT_MISSING", `local_path does not exist: ${project.localPath}`, 503);
    }
  }

  private async clone(project: RegisteredProject): Promise<void> {
    if (!project.config.repo_url) {
      throw new SourceScoutError("PROJECT_REPO_URL_MISSING", `repo_url missing for ${project.config.id}`);
    }
    await mkdir(path.dirname(project.localPath), { recursive: true });
    await this.mustRun("git", ["clone", "--branch", project.config.branch, project.config.repo_url, project.localPath]);
  }

  private async pullExisting(project: RegisteredProject): Promise<void> {
    await this.mustRun("git", ["fetch", "--all", "--prune", "--tags"], project.localPath);
    await this.mustRun("git", ["checkout", project.config.branch], project.localPath);
    await this.mustRun("git", ["pull", "--ff-only"], project.localPath);
  }

  private async tryPull(project: RegisteredProject): Promise<boolean> {
    const result = await runCommand("git", ["fetch", "--all", "--prune", "--tags"], {
      cwd: project.localPath,
      timeoutMs: this.config.workspace.sync_timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      return false;
    }
    const checkout = await runCommand("git", ["checkout", project.config.branch], {
      cwd: project.localPath,
      timeoutMs: this.config.workspace.sync_timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (checkout.exitCode !== 0 || checkout.timedOut) {
      return false;
    }
    const pull = await runCommand("git", ["pull", "--ff-only"], {
      cwd: project.localPath,
      timeoutMs: this.config.workspace.sync_timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    return pull.exitCode === 0 && !pull.timedOut;
  }

  private async mustRun(command: string, args: string[], cwd?: string): Promise<void> {
    const result = await runCommand(command, args, {
      cwd,
      timeoutMs: this.config.workspace.sync_timeout_seconds * 1000,
      maxOutputBytes: this.config.limits.max_tool_output_bytes,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new SourceScoutError(
        "COMMAND_FAILED",
        `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
        500,
        result,
      );
    }
  }

  private async getHead(localPath: string): Promise<string | null> {
    if (!(await this.hasGit(localPath))) {
      return null;
    }
    const result = await runCommand("git", ["rev-parse", "HEAD"], {
      cwd: localPath,
      timeoutMs: this.config.git.timeout_seconds * 1000,
      maxOutputBytes: 4096,
    });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  private async isUsableCheckout(project: RegisteredProject): Promise<boolean> {
    if (!(await this.pathExists(project.localPath))) {
      return false;
    }
    const hasGit = await this.hasGit(project.localPath);
    if (!project.managedClone && !hasGit) {
      return true;
    }
    if (!hasGit) {
      return false;
    }
    const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: project.localPath,
      timeoutMs: this.config.git.timeout_seconds * 1000,
      maxOutputBytes: 4096,
    });
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  private async hasGit(localPath: string): Promise<boolean> {
    return this.pathExists(path.join(localPath, ".git"));
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  private getLock(projectId: string): AsyncLock {
    let lock = this.locks.get(projectId);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(projectId, lock);
    }
    return lock;
  }
}
