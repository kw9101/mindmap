import { describe, expect, it } from "vitest";
import { parseMindmap } from "./parser";
import { parseClipboardNodes, serializeNodeForClipboard } from "./clipboard";

function firstNode(source: string) {
  const result = parseMindmap(source);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(result.diagnostics[0].message);
  }
  return result.mindmap.children[0];
}

describe("clipboard", () => {
  it("serializes a subtree as plain markdown without app metadata", () => {
    const node = firstNode(`# Map

- A
  - B
`);

    expect(serializeNodeForClipboard(node)).toBe(`- A
  - B
`);
  });

  it("parses markdown list clipboard content as nodes", () => {
    const result = parseClipboardNodes(
      `- A
  - B
`,
      "left"
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(result.diagnostics[0].message);
    }
    expect(result.nodes[0]).toMatchObject({
      text: "A",
      direction: "left",
      children: [{ text: "B", direction: "left" }]
    });
  });

  it("turns a single plain text line into one node", () => {
    const result = parseClipboardNodes("plain text", "right");

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(result.diagnostics[0].message);
    }
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ text: "plain text", direction: "right" });
  });

  it("rejects unsupported markdown clipboard structures", () => {
    const result = parseClipboardNodes("1. Ordered", "right");

    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error("Expected parse failure.");
    }
    expect(result.diagnostics[0].code).toBe("MM009");
  });
});
