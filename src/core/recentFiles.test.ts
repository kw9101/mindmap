import { describe, expect, it } from "vitest";
import {
  maxRecentFiles,
  parseRecentFiles,
  rememberRecentFile,
  removeRecentFile,
  serializeRecentFiles
} from "./recentFiles";

describe("recent files", () => {
  it("falls back to an empty list for missing or invalid storage", () => {
    expect(parseRecentFiles(null)).toEqual([]);
    expect(parseRecentFiles("{")).toEqual([]);
    expect(parseRecentFiles(JSON.stringify({ path: "/tmp/a.md" }))).toEqual([]);
  });

  it("sorts, deduplicates, and caps loaded recent files", () => {
    const value = JSON.stringify([
      { path: "/tmp/a.md", name: "old-a.md", lastOpenedAt: 1 },
      { path: "/tmp/b.md", name: "b.md", lastOpenedAt: 2 },
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 3 },
      { path: "", name: "skip.md", lastOpenedAt: 4 },
      { path: "/tmp/c.md", name: "c.md", lastOpenedAt: Number.NaN }
    ]);

    expect(parseRecentFiles(value)).toEqual([
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 3 },
      { path: "/tmp/b.md", name: "b.md", lastOpenedAt: 2 }
    ]);
  });

  it("remembers the newest file first", () => {
    const next = rememberRecentFile(
      [{ path: "/tmp/a.md", name: "a.md", lastOpenedAt: 1 }],
      { path: "/tmp/b.md", name: "b.md" },
      2
    );

    expect(next).toEqual([
      { path: "/tmp/b.md", name: "b.md", lastOpenedAt: 2 },
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 1 }
    ]);
  });

  it("updates existing entries and keeps the list capped", () => {
    const files = Array.from({ length: maxRecentFiles + 2 }, (_, index) => ({
      path: `/tmp/${index}.md`,
      name: `${index}.md`,
      lastOpenedAt: index
    }));

    const next = rememberRecentFile(files, { path: "/tmp/0.md", name: "0.md" }, 99);

    expect(next).toHaveLength(maxRecentFiles);
    expect(next[0]).toEqual({ path: "/tmp/0.md", name: "0.md", lastOpenedAt: 99 });
  });

  it("removes files and serializes normalized data", () => {
    const files = [
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 1 },
      { path: "/tmp/b.md", name: "b.md", lastOpenedAt: 2 }
    ];

    expect(removeRecentFile(files, "/tmp/b.md")).toEqual([
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 1 }
    ]);
    expect(JSON.parse(serializeRecentFiles(files))).toEqual([
      { path: "/tmp/b.md", name: "b.md", lastOpenedAt: 2 },
      { path: "/tmp/a.md", name: "a.md", lastOpenedAt: 1 }
    ]);
  });
});
