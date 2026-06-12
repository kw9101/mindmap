import { describe, expect, it } from "vitest";
import { parseMindmap } from "./parser";
import { serializeMindmap } from "./serializer";
import {
  addChildNode,
  addRootNode,
  addSiblingNode,
  createInitialMindmap,
  deleteNode,
  firstChildNodePath,
  flattenNodes,
  indentNode,
  insertChildNodes,
  insertSiblingNodes,
  moveNodeDown,
  moveNodeUp,
  nextNodePath,
  outdentNode,
  parentNodePath,
  previousNodePath,
  rootNodePath,
  updateNodeText
} from "./tree";

function parse(source: string) {
  const result = parseMindmap(source);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(result.diagnostics[0].message);
  }
  return result.mindmap;
}

describe("mindmap tree commands", () => {
  it("creates a valid empty mindmap", () => {
    const mindmap = createInitialMindmap();

    expect(serializeMindmap(mindmap)).toBe(`#

-
`);
  });

  it("adds and edits child nodes while keeping stable structural paths", () => {
    let mindmap = parse(`# Map

- A
`);

    mindmap = addChildNode(mindmap, "right/0");
    mindmap = updateNodeText(mindmap, "right/0/0", "A-1");

    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
  - A-1
`);
  });

  it("adds left root nodes by enabling direction sections", () => {
    let mindmap = parse(`# Map

- A
`);

    mindmap = addRootNode(mindmap, "left");
    mindmap = updateNodeText(mindmap, "left/0", "B");

    expect(serializeMindmap(mindmap)).toBe(`# Map

## Right

- A

## Left

- B
`);
  });

  it("adds siblings after the selected node", () => {
    let mindmap = parse(`# Map

- A
`);

    mindmap = addSiblingNode(mindmap, "right/0");
    mindmap = updateNodeText(mindmap, "right/1", "B");

    expect(flattenNodes(mindmap).map((node) => node.path)).toEqual([
      "right/0",
      "right/1"
    ]);
    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
- B
`);
  });

  it("indents a node under its previous sibling", () => {
    let mindmap = parse(`# Map

- A
- B
`);

    mindmap = indentNode(mindmap, "right/1");

    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
  - B
`);
  });

  it("outdents a node after its parent", () => {
    let mindmap = parse(`# Map

- A
  - B
`);

    mindmap = outdentNode(mindmap, "right/0/0");

    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
- B
`);
  });

  it("moves nodes within their sibling list", () => {
    let mindmap = parse(`# Map

- A
- B
- C
`);

    mindmap = moveNodeUp(mindmap, "right/2");
    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
- C
- B
`);

    mindmap = moveNodeDown(mindmap, "right/1");
    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
- B
- C
`);
  });

  it("keeps the document valid when deleting the last node", () => {
    const mindmap = deleteNode(
      parse(`# Map

- A
`),
      "right/0"
    );

    expect(serializeMindmap(mindmap)).toBe(`# Map

-
`);
  });

  it("finds parent and first child paths for keyboard selection", () => {
    const mindmap = parse(`# Map

- A
  - B
`);

    expect(parentNodePath(mindmap, "right/0/0")).toBe("right/0");
    expect(parentNodePath(mindmap, "right/0")).toBe(rootNodePath);
    expect(parentNodePath(mindmap, rootNodePath)).toBe(rootNodePath);
    expect(firstChildNodePath(mindmap, "right/0")).toBe("right/0/0");
    expect(firstChildNodePath(mindmap, "right/0/0")).toBe("right/0/0");
    expect(firstChildNodePath(mindmap, rootNodePath)).toBe("right/0");
    expect(previousNodePath(mindmap, "right/0")).toBe(rootNodePath);
    expect(previousNodePath(mindmap, rootNodePath)).toBe(rootNodePath);
    expect(nextNodePath(mindmap, rootNodePath)).toBe("right/0");
  });

  it("inserts copied nodes as siblings or children with inherited direction", () => {
    const mindmap = parse(`# Map

## Right

- A

## Left

- L
`);
    const copied = parse(`# Copy

- B
  - B-1
`).children;

    const asSibling = insertSiblingNodes(mindmap, "left/0", copied);
    expect(serializeMindmap(asSibling)).toBe(`# Map

## Right

- A

## Left

- L
- B
  - B-1
`);

    const asChild = insertChildNodes(mindmap, "left/0", copied);
    expect(serializeMindmap(asChild)).toBe(`# Map

## Right

- A

## Left

- L
  - B
    - B-1
`);
  });
});
