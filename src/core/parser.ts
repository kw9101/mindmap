import { lexer } from "marked";
import { error, type Diagnostic } from "./diagnostics";
import type { Direction, Mindmap, MindmapNode, ParseResult } from "./model";

type ListContext = {
  direction: Direction;
  stack: MindmapNode[];
  rootIndex: number;
};

const headingHelp = "Use canonical headings: '# Title', '#', '## Right', or '## Left'.";
const fileShapeHelp =
  "Use LF line endings, exactly one final newline, no extra trailing blank lines, and no trailing spaces on heading/section/blank lines. Empty nodes must be written as '-'.";

export function parseMindmap(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];

  validateFileShape(source, diagnostics);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  try {
    lexer(source, { gfm: true });
  } catch {
    return {
      ok: false,
      diagnostics: [
        error("MM006", "Markdown parser could not parse this document.", 1, 1)
      ]
    };
  }

  const lines = source.slice(0, -1).split("\n");
  const h1 = parseH1(lines[0]);
  if (h1 === null) {
    const line = lines[0] ?? "";
    const code = line.startsWith("#") ? "MM016" : "MM001";
    return {
      ok: false,
      diagnostics: [
        error(
          code,
          code === "MM001"
            ? "The first block must be a level-1 heading."
            : "The H1 heading is not in the canonical format.",
          1,
          1,
          code === "MM016" ? headingHelp : "Start the file with '# Title' or '#'."
        )
      ]
    };
  }

  if (lines.length < 2 || lines[1] !== "") {
    return {
      ok: false,
      diagnostics: [
        error("MM017", "H1 must be followed by exactly one blank line.", 2, 1)
      ]
    };
  }

  const mindmap: Mindmap = {
    title: h1,
    children: [],
    usesDirectionSections: false,
    sectionOrder: [],
    emptySections: []
  };

  const contexts: Record<Direction, ListContext> = {
    right: { direction: "right", stack: [], rootIndex: 0 },
    left: { direction: "left", stack: [], rootIndex: 0 }
  };

  let currentDirection: Direction | null = null;
  let seenAnyList = false;
  let i = 2;

  while (i < lines.length) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (isH1(line)) {
      return {
        ok: false,
        diagnostics: [error("MM020", "Only one H1 heading is allowed.", lineNumber)]
      };
    }

    if (line === "") {
      if (i + 1 < lines.length && isH1(lines[i + 1])) {
        return {
          ok: false,
          diagnostics: [
            error("MM020", "Only one H1 heading is allowed.", i + 2)
          ]
        };
      }

      if (i + 1 < lines.length && lines[i + 1].startsWith("##")) {
        i += 1;
        continue;
      }

      return {
        ok: false,
        diagnostics: [
          error(
            "MM017",
            "Blank lines are only allowed in canonical heading boundaries.",
            lineNumber
          )
        ]
      };
    }

    if (line.startsWith("##")) {
      const section = parseDirectionHeading(line);
      if (section === null) {
        return {
          ok: false,
          diagnostics: [
            error(
              "MM014",
              "Direction heading must be exactly '## Right' or '## Left'.",
              lineNumber,
              1,
              headingHelp
            )
          ]
        };
      }

      if (mindmap.sectionOrder.includes(section)) {
        return {
          ok: false,
          diagnostics: [
            error(
              "MM015",
              `The ## ${capitalize(section)} section is duplicated.`,
              lineNumber
            )
          ]
        };
      }

      if (i + 1 >= lines.length || lines[i + 1] !== "") {
        return {
          ok: false,
          diagnostics: [
            error(
              "MM017",
              "Direction heading must be followed by exactly one blank line.",
              lineNumber + 1
            )
          ]
        };
      }

      mindmap.usesDirectionSections = true;
      mindmap.sectionOrder.push(section);
      mindmap.emptySections.push(section);
      currentDirection = section;
      contexts[section].stack = [];
      i += 2;
      continue;
    }

    if (line.startsWith("#")) {
      return {
        ok: false,
        diagnostics: [
          error("MM013", "Only H1 and exact direction H2 headings are allowed.", lineNumber)
        ]
      };
    }

    const listLine = parseListLine(line, lineNumber);
    if (!listLine.ok) {
      return { ok: false, diagnostics: [listLine.diagnostic] };
    }

    if (mindmap.usesDirectionSections && currentDirection === null) {
      return {
        ok: false,
        diagnostics: [
          error(
            "MM007",
            "Root list items must be placed under ## Right or ## Left once direction sections are used.",
            lineNumber
          )
        ]
      };
    }

    const direction = currentDirection ?? "right";
    if (mindmap.usesDirectionSections && listLine.depth === 0) {
      removeEmptySection(mindmap, direction);
    }

    const addResult = addNode(mindmap, contexts[direction], listLine.depth, listLine.text, lineNumber);
    if (!addResult.ok) {
      return { ok: false, diagnostics: [addResult.diagnostic] };
    }

    seenAnyList = true;
    i += 1;
  }

  if (!seenAnyList) {
    return {
      ok: false,
      diagnostics: [
        error("MM002", "The mindmap must contain at least one list item.", 1)
      ]
    };
  }

  return { ok: true, mindmap };
}

type ListLineResult =
  | { ok: true; depth: number; text: string }
  | { ok: false; diagnostic: Diagnostic };

type AddNodeResult =
  | { ok: true }
  | { ok: false; diagnostic: Diagnostic };

function validateFileShape(source: string, diagnostics: Diagnostic[]): void {
  if (source.includes("\r\n") || source.includes("\r")) {
    diagnostics.push(
      error("MM018", "Line endings must be LF, not CRLF.", 1, 1, fileShapeHelp)
    );
    return;
  }

  if (!source.endsWith("\n")) {
    diagnostics.push(
      error(
        "MM018",
        "File must end with exactly one trailing newline.",
        1,
        1,
        fileShapeHelp
      )
    );
    return;
  }

  if (source.endsWith("\n\n")) {
    diagnostics.push(
      error(
        "MM018",
        "File must not end with extra blank lines.",
        lineCount(source),
        1,
        fileShapeHelp
      )
    );
    return;
  }

  const lines = source.slice(0, -1).split("\n");
  const trailingIndex = lines.findIndex(
    (line) => /[ \t]$/.test(line) && !isPotentialListLine(line)
  );
  if (trailingIndex !== -1) {
    diagnostics.push(
      error(
        "MM018",
        "Line must not end with trailing spaces or tabs.",
        trailingIndex + 1,
        1,
        fileShapeHelp
      )
    );
  }
}

function parseH1(line: string | undefined): string | null {
  if (line === undefined) {
    return null;
  }

  if (line === "#") {
    return "";
  }

  const match = /^# ([^\s#].*)$/.exec(line);
  if (!match) {
    return null;
  }

  return match[1];
}

function parseDirectionHeading(line: string): Direction | null {
  if (line === "## Right") {
    return "right";
  }

  if (line === "## Left") {
    return "left";
  }

  return null;
}

function parseListLine(line: string, lineNumber: number): ListLineResult {
  const emptyListItem = /^([ \t]*)([-+*]|\d+[.)])$/.exec(line);
  const listLike = emptyListItem ?? /^([ \t]*)([-+*]|\d+[.)]) (.*)$/.exec(line);
  if (!listLike) {
    return {
      ok: false,
      diagnostic: error("MM013", "Only canonical list items are allowed in the mindmap body.", lineNumber)
    };
  }

  const [, indent, marker, text = ""] = listLike;

  if (!emptyListItem && text === "") {
    return {
      ok: false,
      diagnostic: error(
        "MM018",
        "Empty list items must be written without trailing spaces.",
        lineNumber,
        1,
        fileShapeHelp
      )
    };
  }

  if (indent.includes("\t")) {
    return {
      ok: false,
      diagnostic: error("MM011", "Tabs are not allowed in list indentation.", lineNumber)
    };
  }

  if (marker === "*" || marker === "+") {
    return {
      ok: false,
      diagnostic: error("MM010", "Only '-' list markers are allowed.", lineNumber)
    };
  }

  if (marker !== "-") {
    return {
      ok: false,
      diagnostic: error("MM009", "Ordered lists are not supported in the mindmap body.", lineNumber)
    };
  }

  if (indent.length % 2 !== 0) {
    return {
      ok: false,
      diagnostic: error("MM003", "List indentation must use exactly two spaces per depth.", lineNumber)
    };
  }

  if (hasDisallowedControlCharacter(text)) {
    return {
      ok: false,
      diagnostic: error("MM019", "Node text contains a disallowed control character.", lineNumber)
    };
  }

  return {
    ok: true,
    depth: indent.length / 2,
    text
  };
}

function addNode(
  mindmap: Mindmap,
  context: ListContext,
  depth: number,
  text: string,
  lineNumber: number
): AddNodeResult {
  if (depth > 0 && context.stack[depth - 1] === undefined) {
    return {
      ok: false,
      diagnostic: error("MM003", "List indentation cannot skip a parent depth.", lineNumber)
    };
  }

  const siblings =
    depth === 0 ? mindmap.children : context.stack[depth - 1].children;
  const localIndex = siblings.filter((node) => node.direction === context.direction).length;
  const parentPath = depth === 0 ? context.direction : context.stack[depth - 1].path;
  const path = depth === 0 ? `${context.direction}/${context.rootIndex}` : `${parentPath}/${localIndex}`;
  const node: MindmapNode = {
    id: path,
    path,
    text,
    direction: context.direction,
    children: []
  };

  siblings.push(node);
  context.stack[depth] = node;
  context.stack.length = depth + 1;

  if (depth === 0) {
    context.rootIndex += 1;
  }

  return { ok: true };
}

function removeEmptySection(mindmap: Mindmap, direction: Direction): void {
  mindmap.emptySections = mindmap.emptySections.filter((item) => item !== direction);
}

function isH1(line: string): boolean {
  return line === "#" || /^#(?: |$)/.test(line);
}

function isPotentialListLine(line: string): boolean {
  return /^([ \t]*)([-+*]|\d+[.)])(?: .*)?$/.test(line);
}

function hasDisallowedControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function lineCount(value: string): number {
  return value.split("\n").length - 1;
}

function capitalize(direction: Direction): string {
  return direction === "right" ? "Right" : "Left";
}
