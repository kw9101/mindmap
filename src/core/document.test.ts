import { describe, expect, it } from "vitest";
import {
  applyExternalSnapshot,
  chooseAppVersion,
  chooseDiskVersion,
  createUntitledDocument,
  editDocument,
  markSaved,
  openDocument,
  type FileSnapshot
} from "./document";

function snapshot(contents: string, hash = contents): FileSnapshot {
  return {
    path: "/notes/map.md",
    name: "map.md",
    contents,
    hash,
    mtimeMs: 1000,
    size: contents.length
  };
}

describe("document state", () => {
  it("starts with a valid untitled mindmap", () => {
    const document = createUntitledDocument();

    expect(document.source).toBe(`#

-
`);
    expect(document.dirty).toBe(false);
    expect(document.file).toBeNull();
  });

  it("marks edits as pending saves", () => {
    const document = editDocument(createUntitledDocument(), `# A

-
`);

    expect(document.dirty).toBe(true);
    expect(document.saveStatus).toBe("pending");
  });

  it("marks a document clean after save metadata is updated", () => {
    const saved = markSaved(
      editDocument(createUntitledDocument(), `# A

-
`),
      snapshot(`# A

-
`, "hash-a")
    );

    expect(saved.dirty).toBe(false);
    expect(saved.file).toMatchObject({ hash: "hash-a", name: "map.md" });
  });

  it("automatically reloads parseable external changes when clean", () => {
    const original = openDocument(
      snapshot(`# A

-
`, "hash-a")
    );
    const result = applyExternalSnapshot(
      original,
      snapshot(`# B

-
`, "hash-b")
    );

    expect(result.kind).toBe("reloaded");
    expect(result.state.source).toContain("# B");
    expect(result.state.dirty).toBe(false);
  });

  it("keeps the current clean document visible when external markdown is invalid", () => {
    const original = openDocument(
      snapshot(`# A

-
`, "hash-a")
    );
    const result = applyExternalSnapshot(original, snapshot(`# Bad
- missing blank
`, "hash-b"));

    expect(result.kind).toBe("external-error");
    expect(result.state.source).toContain("# A");
    expect(result.state.externalError?.diagnostics[0].code).toBe("MM017");
  });

  it("enters conflict state instead of merging when dirty", () => {
    const clean = openDocument(
      snapshot(`# A

-
`, "hash-a")
    );
    const dirty = editDocument(clean, `# App

-
`);
    const result = applyExternalSnapshot(
      dirty,
      snapshot(`# Disk

-
`, "hash-b")
    );

    expect(result.kind).toBe("conflict");
    expect(result.state.conflict?.appSource).toContain("# App");
    expect(result.state.conflict?.disk.contents).toContain("# Disk");
  });

  it("can choose disk or app version from a conflict", () => {
    const dirty = editDocument(
      openDocument(
        snapshot(`# A

-
`, "hash-a")
      ),
      `# App

-
`
    );
    const result = applyExternalSnapshot(
      dirty,
      snapshot(`# Disk

-
`, "hash-b")
    );

    expect(chooseDiskVersion(result.state).source).toContain("# Disk");
    expect(chooseAppVersion(result.state)).toMatchObject({
      dirty: true,
      saveStatus: "pending",
      conflict: null
    });
  });
});
