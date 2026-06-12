import type { Direction, Mindmap, MindmapNode } from "./model";

export const rootNodePath = "root";

export type NodeLocation = {
  node: MindmapNode;
  parent: MindmapNode | null;
  siblings: MindmapNode[];
  index: number;
};

export function createInitialMindmap(): Mindmap {
  return normalizeMindmap({
    title: "",
    children: [createNode("right", "")],
    usesDirectionSections: false,
    sectionOrder: [],
    emptySections: []
  });
}

export function updateRootTitle(mindmap: Mindmap, title: string): Mindmap {
  return normalizeMindmap({ ...mindmap, title });
}

export function updateNodeText(mindmap: Mindmap, path: string, text: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  location.node.text = text;
  return normalizeMindmap(next);
}

export function addRootNode(mindmap: Mindmap, direction: Direction): Mindmap {
  const next = cloneMindmap(mindmap);
  next.children.push(createNode(direction, ""));
  if (direction === "left" || next.usesDirectionSections) {
    next.usesDirectionSections = true;
    next.sectionOrder = ensureDirectionOrder(next.sectionOrder, direction);
    if (!next.sectionOrder.includes("right")) {
      next.sectionOrder = ["right", ...next.sectionOrder];
    }
  }

  return normalizeMindmap(next);
}

export function addChildNode(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  location.node.children.push(createNode(location.node.direction, ""));
  return normalizeMindmap(next);
}

export function addSiblingNode(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  location.siblings.splice(location.index + 1, 0, createNode(location.node.direction, ""));
  return normalizeMindmap(next);
}

export function deleteNode(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  location.siblings.splice(location.index, 1);
  if (countNodes(next.children) === 0) {
    return normalizeMindmap({
      ...next,
      children: [createNode("right", "")],
      usesDirectionSections: false,
      sectionOrder: [],
      emptySections: []
    });
  }

  return normalizeMindmap(next);
}

export function indentNode(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location || location.index === 0) {
    return mindmap;
  }

  const previousSibling = location.siblings[location.index - 1];
  const [node] = location.siblings.splice(location.index, 1);
  setSubtreeDirection(node, previousSibling.direction);
  previousSibling.children.push(node);
  return normalizeMindmap(next);
}

export function outdentNode(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location || location.parent === null) {
    return mindmap;
  }

  const parentLocation = findNodeLocation(next, location.parent.path);
  if (!parentLocation) {
    return mindmap;
  }

  const [node] = location.siblings.splice(location.index, 1);
  setSubtreeDirection(node, location.parent.direction);
  parentLocation.siblings.splice(parentLocation.index + 1, 0, node);
  return normalizeMindmap(next);
}

export function moveNodeUp(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location || location.index === 0) {
    return mindmap;
  }

  swap(location.siblings, location.index, location.index - 1);
  return normalizeMindmap(next);
}

export function moveNodeDown(mindmap: Mindmap, path: string): Mindmap {
  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location || location.index >= location.siblings.length - 1) {
    return mindmap;
  }

  swap(location.siblings, location.index, location.index + 1);
  return normalizeMindmap(next);
}

export function insertSiblingNodes(
  mindmap: Mindmap,
  path: string,
  nodes: MindmapNode[]
): Mindmap {
  if (nodes.length === 0) {
    return mindmap;
  }

  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  const inserted = nodes.map((node) => cloneWithDirection(node, location.node.direction));
  location.siblings.splice(location.index + 1, 0, ...inserted);
  return normalizeMindmap(next);
}

export function insertChildNodes(
  mindmap: Mindmap,
  path: string,
  nodes: MindmapNode[]
): Mindmap {
  if (nodes.length === 0) {
    return mindmap;
  }

  const next = cloneMindmap(mindmap);
  const location = findNodeLocation(next, path);
  if (!location) {
    return mindmap;
  }

  location.node.children.push(
    ...nodes.map((node) => cloneWithDirection(node, location.node.direction))
  );
  return normalizeMindmap(next);
}

export function findNode(mindmap: Mindmap, path: string): MindmapNode | null {
  return findNodeLocation(mindmap, path)?.node ?? null;
}

export function isRootNodePath(path: string): boolean {
  return path === rootNodePath;
}

export function flattenNodes(mindmap: Mindmap): MindmapNode[] {
  const nodes: MindmapNode[] = [];
  for (const root of mindmap.children) {
    collectNodes(root, nodes);
  }
  return nodes;
}

export function nextNodePath(mindmap: Mindmap, path: string): string {
  const nodes = flattenNodes(mindmap);
  if (isRootNodePath(path)) {
    return nodes[0]?.path ?? rootNodePath;
  }

  const index = nodes.findIndex((node) => node.path === path);
  if (index === -1 || nodes.length === 0) {
    return nodes[0]?.path ?? "";
  }

  return nodes[Math.min(index + 1, nodes.length - 1)].path;
}

export function nextSiblingNodePath(mindmap: Mindmap, path: string): string {
  const location = findNodeLocation(mindmap, path);
  if (!location) {
    return path;
  }

  return location.siblings[location.index + 1]?.path ?? path;
}

export function previousSiblingNodePath(mindmap: Mindmap, path: string): string {
  const location = findNodeLocation(mindmap, path);
  if (!location) {
    return path;
  }

  return location.siblings[location.index - 1]?.path ?? path;
}

export function previousNodePath(mindmap: Mindmap, path: string): string {
  const nodes = flattenNodes(mindmap);
  if (isRootNodePath(path)) {
    return rootNodePath;
  }

  const index = nodes.findIndex((node) => node.path === path);
  if (index === -1 || nodes.length === 0) {
    return nodes[0]?.path ?? "";
  }

  return index === 0 ? rootNodePath : nodes[index - 1].path;
}

export function parentNodePath(mindmap: Mindmap, path: string): string {
  if (isRootNodePath(path)) {
    return rootNodePath;
  }

  const location = findNodeLocation(mindmap, path);
  return location?.parent?.path ?? (location ? rootNodePath : path);
}

export function firstChildNodePath(mindmap: Mindmap, path: string): string {
  if (isRootNodePath(path)) {
    return firstNodePath(mindmap) || rootNodePath;
  }

  const node = findNode(mindmap, path);
  return node?.children[0]?.path ?? path;
}

export function firstNodePath(mindmap: Mindmap): string {
  return flattenNodes(mindmap)[0]?.path ?? "";
}

export function normalizeMindmap(mindmap: Mindmap): Mindmap {
  const next = cloneMindmap(mindmap);
  if (next.children.length === 0) {
    next.children.push(createNode("right", ""));
  }

  const hasLeftRoot = next.children.some((node) => node.direction === "left");
  next.usesDirectionSections = next.usesDirectionSections || hasLeftRoot;
  if (!next.usesDirectionSections) {
    for (const child of next.children) {
      setSubtreeDirection(child, "right");
    }
    next.sectionOrder = [];
    next.emptySections = [];
  } else {
    next.sectionOrder = normalizeSectionOrder(next.sectionOrder, next.children);
  }

  const rootIndexes: Record<Direction, number> = { right: 0, left: 0 };
  for (const child of next.children) {
    const rootIndex = rootIndexes[child.direction];
    assignPaths(child, `${child.direction}/${rootIndex}`, child.direction);
    rootIndexes[child.direction] += 1;
  }

  next.emptySections = next.usesDirectionSections
    ? next.sectionOrder.filter(
        (direction) => !next.children.some((node) => node.direction === direction)
      )
    : [];

  return next;
}

function findNodeLocation(mindmap: Mindmap, path: string): NodeLocation | null {
  return findInSiblings(mindmap.children, path, null);
}

function findInSiblings(
  siblings: MindmapNode[],
  path: string,
  parent: MindmapNode | null
): NodeLocation | null {
  for (let index = 0; index < siblings.length; index += 1) {
    const node = siblings[index];
    if (node.path === path) {
      return { node, parent, siblings, index };
    }

    const childLocation = findInSiblings(node.children, path, node);
    if (childLocation) {
      return childLocation;
    }
  }

  return null;
}

function assignPaths(node: MindmapNode, path: string, direction: Direction): void {
  node.id = path;
  node.path = path;
  node.direction = direction;
  node.children.forEach((child, index) => {
    assignPaths(child, `${path}/${index}`, direction);
  });
}

function setSubtreeDirection(node: MindmapNode, direction: Direction): void {
  node.direction = direction;
  for (const child of node.children) {
    setSubtreeDirection(child, direction);
  }
}

function cloneWithDirection(node: MindmapNode, direction: Direction): MindmapNode {
  const cloned = cloneNode(node);
  setSubtreeDirection(cloned, direction);
  return cloned;
}

function normalizeSectionOrder(order: Direction[], children: MindmapNode[]): Direction[] {
  const next: Direction[] = [];
  for (const direction of order) {
    if (!next.includes(direction)) {
      next.push(direction);
    }
  }

  for (const child of children) {
    if (!next.includes(child.direction)) {
      next.push(child.direction);
    }
  }

  if (next.length === 0) {
    return ["right", "left"];
  }

  if (next.includes("left") && !next.includes("right")) {
    return ["right", ...next];
  }

  return next;
}

function ensureDirectionOrder(order: Direction[], direction: Direction): Direction[] {
  if (order.includes(direction)) {
    return order;
  }

  return [...order, direction];
}

function createNode(direction: Direction, text: string): MindmapNode {
  return {
    id: "",
    path: "",
    text,
    direction,
    children: []
  };
}

function collectNodes(node: MindmapNode, nodes: MindmapNode[]): void {
  nodes.push(node);
  for (const child of node.children) {
    collectNodes(child, nodes);
  }
}

function countNodes(nodes: MindmapNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}

function swap<T>(items: T[], first: number, second: number): void {
  const item = items[first];
  items[first] = items[second];
  items[second] = item;
}

function cloneMindmap(mindmap: Mindmap): Mindmap {
  return {
    title: mindmap.title,
    usesDirectionSections: mindmap.usesDirectionSections,
    sectionOrder: [...mindmap.sectionOrder],
    emptySections: [...mindmap.emptySections],
    children: mindmap.children.map(cloneNode)
  };
}

function cloneNode(node: MindmapNode): MindmapNode {
  return {
    id: node.id,
    path: node.path,
    text: node.text,
    direction: node.direction,
    children: node.children.map(cloneNode)
  };
}
