import { error, type Diagnostic } from "./diagnostics";
import type { Direction, MindmapNode } from "./model";
import { parseMindmap } from "./parser";

export type ClipboardParseResult =
  | { ok: true; nodes: MindmapNode[] }
  | { ok: false; diagnostics: Diagnostic[] };

export function serializeNodeForClipboard(node: MindmapNode): string {
  return serializeNodesForClipboard([node]);
}

export function serializeNodesForClipboard(nodes: MindmapNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    writeNode(lines, node, 0);
  }
  return `${lines.join("\n")}\n`;
}

export function parseClipboardNodes(
  text: string,
  direction: Direction
): ClipboardParseResult {
  if (text.length === 0) {
    return {
      ok: false,
      diagnostics: [error("MM002", "Clipboard is empty.", 1)]
    };
  }

  if (text.includes("\r")) {
    return {
      ok: false,
      diagnostics: [error("MM018", "Clipboard Markdown must use LF line endings.", 1)]
    };
  }

  if (isSingleLinePlainText(text)) {
    return {
      ok: true,
      nodes: [
        {
          id: "",
          path: "",
          text,
          direction,
          children: []
        }
      ]
    };
  }

  const body = text.endsWith("\n") ? text : `${text}\n`;
  const parsed = parseMindmap(`# Clipboard\n\n${body}`);
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    nodes: parsed.mindmap.children.map((node) => cloneWithDirection(node, direction))
  };
}

function writeNode(lines: string[], node: MindmapNode, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(node.text.length > 0 ? `${indent}- ${node.text}` : `${indent}-`);

  for (const child of node.children) {
    writeNode(lines, child, depth + 1);
  }
}

function isSingleLinePlainText(text: string): boolean {
  return !text.includes("\n") && !/^[ \t]*([-+*]|\d+[.)])(?: |$)/.test(text);
}

function cloneWithDirection(node: MindmapNode, direction: Direction): MindmapNode {
  return {
    id: "",
    path: "",
    text: node.text,
    direction,
    children: node.children.map((child) => cloneWithDirection(child, direction))
  };
}
