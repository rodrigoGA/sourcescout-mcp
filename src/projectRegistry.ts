import path from "node:path";
import type { AppConfig, ProjectRuntimeState, ProjectStateMap, RegisteredProject } from "./types.js";
import { SourceScoutError } from "./types.js";
import { StateStore } from "./stateStore.js";
import { AsyncLock } from "./asyncLock.js";

export class ProjectRegistry {
  private readonly projects = new Map<string, RegisteredProject>();
  private readonly stateStore: StateStore;
  private readonly stateLock = new AsyncLock();

  private constructor(
    private readonly config: AppConfig,
    stateStore: StateStore,
  ) {
    this.stateStore = stateStore;
  }

  static async create(config: AppConfig): Promise<ProjectRegistry> {
    const stateStore = new StateStore(config.workspace.state_path);
    const savedState = await stateStore.load();
    const registry = new ProjectRegistry(config, stateStore);
    registry.loadProjects(savedState);
    await registry.save();
    return registry;
  }

  list(includeDisabled: boolean): RegisteredProject[] {
    return [...this.projects.values()].filter((project) => includeDisabled || project.config.enabled);
  }

  get(projectId: string): RegisteredProject {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new SourceScoutError("PROJECT_NOT_FOUND", `unknown project_id: ${projectId}`, 404);
    }
    if (!project.config.enabled) {
      throw new SourceScoutError("PROJECT_DISABLED", `project is disabled: ${projectId}`, 403);
    }
    return project;
  }

  getOptional(projectId: string): RegisteredProject | undefined {
    return this.projects.get(projectId);
  }

  snapshot(): ProjectStateMap {
    const state: ProjectStateMap = {};
    for (const [id, project] of this.projects) {
      state[id] = project.state;
    }
    return state;
  }

  async updateState(projectId: string, patch: Partial<ProjectRuntimeState>): Promise<void> {
    await this.stateLock.runExclusive(async () => {
      const project = this.projects.get(projectId);
      if (!project) {
        throw new SourceScoutError("PROJECT_NOT_FOUND", `unknown project_id: ${projectId}`, 404);
      }
      project.state = { ...project.state, ...patch };
      await this.saveSnapshot();
    });
  }

  async save(): Promise<void> {
    await this.stateLock.runExclusive(() => this.saveSnapshot());
  }

  private async saveSnapshot(): Promise<void> {
    await this.stateStore.save(this.snapshot());
  }

  private loadProjects(savedState: ProjectStateMap): void {
    for (const project of this.config.projects) {
      const localPath = project.local_path
        ? path.resolve(project.local_path)
        : path.resolve(this.config.workspace.root, project.id);
      const saved = savedState[project.id];
      const state: ProjectRuntimeState = {
        status: project.enabled ? (saved?.status ?? "missing") : "disabled",
        last_sync_at: saved?.last_sync_at ?? null,
        last_error: saved?.last_error ?? null,
        local_path: localPath,
        current_head: saved?.current_head ?? null,
      };
      this.projects.set(project.id, {
        config: project,
        localPath,
        managedClone: !project.local_path,
        state,
      });
    }
  }
}
