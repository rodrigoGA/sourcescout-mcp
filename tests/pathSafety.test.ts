import { describe, expect, it } from "vitest";
import { normalizeRelativePath } from "../src/pathSafety.js";

describe("path safety", () => {
  it("normalizes relative paths", () => {
    expect(normalizeRelativePath("src/../README.md")).toBe("README.md");
    expect(normalizeRelativePath(undefined)).toBe(".");
  });

  it("rejects path traversal and absolute paths", () => {
    expect(() => normalizeRelativePath("../secret")).toThrow(/escapes/);
    expect(() => normalizeRelativePath("/etc/passwd")).toThrow(/relative/);
    expect(() => normalizeRelativePath("src/\0x")).toThrow(/null byte/);
  });
});
