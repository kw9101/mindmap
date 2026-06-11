import type { Direction, Mindmap, MindmapNode } from "./model";

export function serializeMindmap(mindmap: Mindmap): string {
  const lines: string[] = [formatH1(mindmap.title), ""];

  if (mindmap.usesDirectionSections) {
    const order =
      mindmap.sectionOrder.length > 0
        ? mindmap.sectionOrder
        : (["right", "left"] satisfies Direction[]);

    for (const direction of order) {
      lines.push(`## ${capitalize(direction)}`, "");
      const roots = mindmap.children.filter((node) => node.direction === direction);
      for (const root of roots) {
        writeNode(lines, root, 0);
      }

      if (direction !== order[order.length - 1]) {
        lines.push("");
      }
    }
  } else {
    for (const child of mindmap.children) {
      writeNode(lines, child, 0);
    }
  }

  return `${lines.join("\n")}\n`;
}

function writeNode(lines: string[], node: MindmapNode, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(node.text.length > 0 ? `${indent}- ${node.text}` : `${indent}-`);

  for (const child of node.children) {
    writeNode(lines, child, depth + 1);
  }
}

function formatH1(title: string): string {
  return title.length > 0 ? `# ${title}` : "#";
}

function capitalize(direction: Direction): string {
  return direction === "right" ? "Right" : "Left";
}
