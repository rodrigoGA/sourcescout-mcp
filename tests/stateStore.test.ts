import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/stateStore.js";

describe("StateStore", () => {
  it("serializes concurrent saves into valid JSON", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sourcescout-state-"));
    const store = new StateStore(root);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.save({
          app: {
            status: "ready",
            last_sync_at: `2026-05-16T00:00:${String(index).padStart(2, "0")}Z`,
            last_error: null,
            local_path: `/repo/${index}`,
            current_head: String(index),
          },
        }),
      ),
    );

    const raw = await readFile(path.join(root, "projects.json"), "utf8");
    const parsed = JSON.parse(raw) as { app?: { status?: string } };
    expect(parsed.app?.status).toBe("ready");
  });
});
