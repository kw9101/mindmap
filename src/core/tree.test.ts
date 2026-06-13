import { describe, expect, it } from "vitest";
import { parseMindmap } from "./parser";
import { serializeMindmap } from "./serializer";
import {
  addChildNode,
  addPreviousSiblingNode,
  addRootNode,
  addSiblingNode,
  createInitialMindmap,
  deleteNode,
  deleteNodes,
  firstChildNodePath,
  flattenNodes,
  indentNode,
  insertChildNodes,
  insertSiblingNodes,
  cloneNodesForPaths,
  moveNodeByDirection,
  moveNodeDown,
  moveNodesByDirection,
  moveNodeTo,
  moveNodeUp,
  nextNodePath,
  nextSiblingNodePath,
  outdentNode,
  parentNodePath,
  previousNodePath,
  previousSiblingNodePath,
  rootNodePath,
  selectedTopLevelNodePaths,
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

  it("adds previous siblings before the selected node", () => {
    let mindmap = parse(`# Map

- A
`);

    mindmap = addPreviousSiblingNode(mindmap, "right/0");
    mindmap = updateNodeText(mindmap, "right/0", "Before");

    expect(serializeMindmap(mindmap)).toBe(`# Map

- Before
- A
`);
  });

  it("finds the inserted sibling instead of the first child", () => {
    let mindmap = parse(`# Map

- A
  - A-1
`);

    mindmap = addSiblingNode(mindmap, "right/0");

    expect(nextNodePath(mindmap, "right/0")).toBe("right/0/0");
    expect(nextSiblingNodePath(mindmap, "right/0")).toBe("right/1");
  });

  it("finds vertical sibling paths for arrow navigation", () => {
    const mindmap = parse(`# Map

- A
  - A-1
- B
`);

    expect(nextNodePath(mindmap, "right/0")).toBe("right/0/0");
    expect(nextSiblingNodePath(mindmap, "right/0")).toBe("right/1");
    expect(previousSiblingNodePath(mindmap, "right/1")).toBe("right/0");
    expect(previousSiblingNodePath(mindmap, "right/0")).toBe("right/0");
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

  it("moves right branch nodes by visual keyboard direction", () => {
    const mindmap = parse(`# Map

- A
- B
`);

    const movedDown = moveNodeByDirection(mindmap, "right/0", "down");
    expect(movedDown).not.toBeNull();
    expect(movedDown!.movedPath).toBe("right/1");
    expect(serializeMindmap(movedDown!.mindmap)).toBe(`# Map

- B
- A
`);

    const movedUp = moveNodeByDirection(movedDown!.mindmap, "right/1", "up");
    expect(movedUp).not.toBeNull();
    expect(movedUp!.movedPath).toBe("right/0");
    expect(serializeMindmap(movedUp!.mindmap)).toBe(`# Map

- A
- B
`);

    const indented = moveNodeByDirection(mindmap, "right/1", "right");
    expect(indented).not.toBeNull();
    expect(indented!.movedPath).toBe("right/0/0");
    expect(serializeMindmap(indented!.mindmap)).toBe(`# Map

- A
  - B
`);

    const outdented = moveNodeByDirection(indented!.mindmap, "right/0/0", "left");
    expect(outdented).not.toBeNull();
    expect(outdented!.movedPath).toBe("right/1");
    expect(serializeMindmap(outdented!.mindmap)).toBe(`# Map

- A
- B
`);
  });

  it("mirrors horizontal keyboard moves on the left branch", () => {
    const mindmap = parse(`# Map

## Right

- R

## Left

- L1
- L2
`);

    const indented = moveNodeByDirection(mindmap, "left/1", "left");
    expect(indented).not.toBeNull();
    expect(indented!.movedPath).toBe("left/0/0");
    expect(serializeMindmap(indented!.mindmap)).toBe(`# Map

## Right

- R

## Left

- L1
  - L2
`);

    const outdented = moveNodeByDirection(indented!.mindmap, "left/0/0", "right");
    expect(outdented).not.toBeNull();
    expect(outdented!.movedPath).toBe("left/1");
    expect(serializeMindmap(outdented!.mindmap)).toBe(`# Map

## Right

- R

## Left

- L1
- L2
`);
  });

  it("moves root nodes across branches by horizontal keyboard direction", () => {
    const movedLeft = moveNodeByDirection(
      parse(`# Map

- A
`),
      "right/0",
      "left"
    );

    expect(movedLeft).not.toBeNull();
    expect(movedLeft!.movedPath).toBe("left/0");
    expect(serializeMindmap(movedLeft!.mindmap)).toBe(`# Map

## Right


## Left

- A
`);

    const movedRight = moveNodeByDirection(
      parse(`# Map

## Right

- R

## Left

- L
`),
      "left/0",
      "right"
    );

    expect(movedRight).not.toBeNull();
    expect(movedRight!.movedPath).toBe("right/1");
    expect(serializeMindmap(movedRight!.mindmap)).toBe(`# Map

## Right

- R
- L
`);
  });

  it("does not keyboard-move the root or nodes without a target", () => {
    const mindmap = parse(`# Map

- A
`);

    expect(moveNodeByDirection(mindmap, rootNodePath, "right")).toBeNull();
    expect(moveNodeByDirection(mindmap, "right/0", "up")).toBeNull();
    expect(moveNodeByDirection(mindmap, "right/0", "right")).toBeNull();
  });

  it("moves a node before or after another node", () => {
    let mindmap = parse(`# Map

- A
- B
- C
`);

    const moveBefore = moveNodeTo(mindmap, "right/2", "right/0", "before");
    expect(moveBefore).not.toBeNull();
    mindmap = moveBefore!.mindmap;

    expect(moveBefore!.movedPath).toBe("right/0");
    expect(serializeMindmap(mindmap)).toBe(`# Map

- C
- A
- B
`);

    const moveAfter = moveNodeTo(mindmap, "right/0", "right/2", "after");
    expect(moveAfter).not.toBeNull();

    expect(moveAfter!.movedPath).toBe("right/2");
    expect(serializeMindmap(moveAfter!.mindmap)).toBe(`# Map

- A
- B
- C
`);
  });

  it("moves a node into another node as the last child", () => {
    const result = moveNodeTo(
      parse(`# Map

- A
  - A-1
- B
`),
      "right/1",
      "right/0",
      "inside"
    );

    expect(result).not.toBeNull();
    expect(result!.movedPath).toBe("right/0/1");
    expect(serializeMindmap(result!.mindmap)).toBe(`# Map

- A
  - A-1
  - B
`);
  });

  it("moves a node to the opposite root branch when dropped on the root", () => {
    const result = moveNodeTo(
      parse(`# Map

- A
- B
`),
      "right/1",
      rootNodePath,
      "inside",
      "left"
    );

    expect(result).not.toBeNull();
    expect(result!.movedPath).toBe("left/0");
    expect(serializeMindmap(result!.mindmap)).toBe(`# Map

## Right

- A

## Left

- B
`);
  });

  it("keeps root siblings scoped to their direction after moving across branches", () => {
    const moved = moveNodeTo(
      parse(`# Map

- A
- B
`),
      "right/1",
      rootNodePath,
      "inside",
      "left"
    );
    expect(moved).not.toBeNull();
    const mindmap = moved!.mindmap;

    expect(nextSiblingNodePath(mindmap, "right/0")).toBe("right/0");
    expect(previousSiblingNodePath(mindmap, "left/0")).toBe("left/0");

    const withRightSibling = addSiblingNode(mindmap, "right/0");
    expect(nextSiblingNodePath(withRightSibling, "right/0")).toBe("right/1");
    expect(serializeMindmap(withRightSibling)).toBe(`# Map

## Right

- A
-

## Left

- B
`);
  });

  it("moves root nodes up and down only within the same branch direction", () => {
    const mindmap = parse(`# Map

## Right

- A
- B

## Left

- L
`);

    expect(serializeMindmap(moveNodeDown(mindmap, "right/1"))).toBe(
      serializeMindmap(mindmap)
    );
    expect(serializeMindmap(moveNodeUp(mindmap, "left/0"))).toBe(
      serializeMindmap(mindmap)
    );

    expect(serializeMindmap(moveNodeUp(mindmap, "right/1"))).toBe(`# Map

## Right

- B
- A

## Left

- L
`);
  });

  it("does not move a node into itself or its descendants", () => {
    const mindmap = parse(`# Map

- A
  - A-1
- B
`);

    expect(moveNodeTo(mindmap, "right/0", "right/0", "inside")).toBeNull();
    expect(moveNodeTo(mindmap, "right/0", "right/0/0", "inside")).toBeNull();
    expect(serializeMindmap(mindmap)).toBe(`# Map

- A
  - A-1
- B
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

  it("normalizes multi-node selections to top-level document order", () => {
    const mindmap = parse(`# Map

- A
  - A-1
- B
- C
`);

    expect(
      selectedTopLevelNodePaths(mindmap, [
        "right/2",
        "right/0/0",
        "right/0",
        rootNodePath,
        "right/1"
      ])
    ).toEqual(["right/0", "right/1", "right/2"]);
  });

  it("clones selected top-level nodes for multi-node clipboard commands", () => {
    const mindmap = parse(`# Map

- A
  - A-1
- B
`);

    const nodes = cloneNodesForPaths(mindmap, ["right/0", "right/0/0", "right/1"]);

    expect(nodes.map((node) => node.text)).toEqual(["A", "B"]);
    expect(nodes[0].children.map((node) => node.text)).toEqual(["A-1"]);
  });

  it("deletes multiple selected nodes in one command", () => {
    const mindmap = parse(`# Map

- A
  - A-1
- B
- C
`);

    expect(
      serializeMindmap(deleteNodes(mindmap, ["right/0", "right/0/0", "right/2"]))
    ).toBe(`# Map

- B
`);
  });

  it("moves selected sibling blocks by keyboard direction", () => {
    let result = moveNodesByDirection(
      parse(`# Map

- A
- B
- C
- D
`),
      ["right/1", "right/2"],
      "up"
    );

    expect(result).not.toBeNull();
    expect(result!.movedPaths).toEqual(["right/0", "right/1"]);
    expect(serializeMindmap(result!.mindmap)).toBe(`# Map

- B
- C
- A
- D
`);

    result = moveNodesByDirection(result!.mindmap, ["right/0", "right/1"], "down");
    expect(result).not.toBeNull();
    expect(result!.movedPaths).toEqual(["right/1", "right/2"]);
    expect(serializeMindmap(result!.mindmap)).toBe(`# Map

- A
- B
- C
- D
`);
  });

  it("indents and outdents selected sibling blocks", () => {
    const indented = moveNodesByDirection(
      parse(`# Map

- A
- B
- C
`),
      ["right/1", "right/2"],
      "right"
    );

    expect(indented).not.toBeNull();
    expect(indented!.movedPaths).toEqual(["right/0/0", "right/0/1"]);
    expect(serializeMindmap(indented!.mindmap)).toBe(`# Map

- A
  - B
  - C
`);

    const outdented = moveNodesByDirection(
      indented!.mindmap,
      ["right/0/0", "right/0/1"],
      "left"
    );
    expect(outdented).not.toBeNull();
    expect(outdented!.movedPaths).toEqual(["right/1", "right/2"]);
    expect(serializeMindmap(outdented!.mindmap)).toBe(`# Map

- A
- B
- C
`);
  });

  it("moves selected root blocks across branches", () => {
    const result = moveNodesByDirection(
      parse(`# Map

- A
- B
`),
      ["right/0", "right/1"],
      "left"
    );

    expect(result).not.toBeNull();
    expect(result!.movedPaths).toEqual(["left/0", "left/1"]);
    expect(serializeMindmap(result!.mindmap)).toBe(`# Map

## Right


## Left

- A
- B
`);
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
