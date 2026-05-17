import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectStateMap } from "./types.js";
import { AsyncLock } from "./asyncLock.js";

export class StateStore {
  private readonly stateFile: string;
  private readonly lock = new AsyncLock();

  constructor(statePath: string) {
    this.stateFile = path.join(statePath, "projects.json");
  }

  async load(): Promise<ProjectStateMap> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      return JSON.parse(raw) as ProjectStateMap;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async save(state: ProjectStateMap): Promise<void> {
    await this.lock.runExclusive(async () => {
      await mkdir(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(tmp, this.stateFile);
    });
  }
}
