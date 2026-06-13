import { describe, expect, it } from "vitest";
import {
  filterWorkspaceFiles,
  parseWorkspaceDirectory,
  serializeWorkspaceDirectory,
  workspaceDirectoryName,
  type WorkspaceMarkdownFile
} from "./workspace";

describe("workspace directory storage", () => {
  it("parses valid workspace directories and rejects invalid values", () => {
    expect(
      parseWorkspaceDirectory(JSON.stringify({ path: " /tmp/vault ", name: " Vault " }))
    ).toEqual({ path: "/tmp/vault", name: "Vault" });
    expect(parseWorkspaceDirectory(null)).toBeNull();
    expect(parseWorkspaceDirectory("{")).toBeNull();
    expect(parseWorkspaceDirectory(JSON.stringify({ path: "/tmp/vault" }))).toBeNull();
    expect(parseWorkspaceDirectory(JSON.stringify({ path: "", name: "Vault" }))).toBeNull();
  });

  it("serializes normalized workspace directory data", () => {
    expect(
      JSON.parse(serializeWorkspaceDirectory({ path: " /tmp/vault ", name: " Vault " }))
    ).toEqual({ path: "/tmp/vault", name: "Vault" });
  });

  it("derives a display name from a filesystem path", () => {
    expect(workspaceDirectoryName("/Users/kw/Vault/")).toBe("Vault");
    expect(workspaceDirectoryName("C:\\Users\\kw\\Vault")).toBe("Vault");
  });
});

describe("workspace file filtering", () => {
  const files: WorkspaceMarkdownFile[] = [
    file("Daily.md", "Daily.md"),
    file("Roadmap.md", "projects/Roadmap.md"),
    file("Archive.md", "archive/Old Archive.md")
  ];

  it("returns all files when the query is empty", () => {
    expect(filterWorkspaceFiles(files, "")).toBe(files);
  });

  it("matches file name and relative path terms case-insensitively", () => {
    expect(filterWorkspaceFiles(files, "road").map((item) => item.relativePath)).toEqual([
      "projects/Roadmap.md"
    ]);
    expect(filterWorkspaceFiles(files, "ARCHIVE old").map((item) => item.relativePath)).toEqual([
      "archive/Old Archive.md"
    ]);
  });
});

function file(name: string, relativePath: string): WorkspaceMarkdownFile {
  return {
    path: `/tmp/vault/${relativePath}`,
    name,
    relativePath,
    mtimeMs: 1,
    size: 10
  };
}
