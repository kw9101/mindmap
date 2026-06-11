import { describe, expect, it } from "vitest";
import { parseMindmap } from "./parser";
import { serializeMindmap } from "./serializer";

function expectOk(source: string) {
  const result = parseMindmap(source);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(`Expected parse success, got ${result.diagnostics[0].code}`);
  }
  return result.mindmap;
}

function expectCode(source: string, code: string) {
  const result = parseMindmap(source);
  expect(result).toMatchObject({ ok: false });
  if (result.ok) {
    throw new Error("Expected parse failure.");
  }
  expect(result.diagnostics[0].code).toBe(code);
}

describe("parseMindmap", () => {
  it("parses a simple right-only mindmap", () => {
    const mindmap = expectOk(`# Map

- A
  - A-1
- B
`);

    expect(mindmap.title).toBe("Map");
    expect(mindmap.usesDirectionSections).toBe(false);
    expect(mindmap.children.map((node) => node.text)).toEqual(["A", "B"]);
    expect(mindmap.children[0].children[0]).toMatchObject({
      path: "right/0/0",
      text: "A-1",
      direction: "right"
    });
  });

  it("parses explicit right and left sections", () => {
    const mindmap = expectOk(`# Map

## Right

- A

## Left

- B
`);

    expect(mindmap.usesDirectionSections).toBe(true);
    expect(mindmap.sectionOrder).toEqual(["right", "left"]);
    expect(mindmap.children.map((node) => [node.text, node.direction])).toEqual([
      ["A", "right"],
      ["B", "left"]
    ]);
  });

  it("allows empty H1, empty section, and empty node", () => {
    const mindmap = expectOk(`#

## Right

## Left

-
`);

    expect(mindmap.title).toBe("");
    expect(mindmap.emptySections).toEqual(["right"]);
    expect(mindmap.children[0]).toMatchObject({ text: "", direction: "left" });
  });

  it("preserves trailing spaces inside list item text", () => {
    const source = `# Map

- A 
-  
`;
    const mindmap = expectOk(source);

    expect(mindmap.children.map((node) => node.text)).toEqual(["A ", " "]);
    expect(serializeMindmap(mindmap)).toBe(source);
  });

  it("round-trips canonical markdown", () => {
    const source = `# Map

## Left

- B

## Right

- A
  - A-1
`;
    const mindmap = expectOk(source);

    expect(serializeMindmap(mindmap)).toBe(source);
  });

  it("rejects ordered lists", () => {
    expectCode(`# Map

1. A
`, "MM009");
  });

  it("rejects non-canonical unordered markers", () => {
    expectCode(`# Map

* A
`, "MM010");
  });

  it("rejects odd indentation", () => {
    expectCode(`# Map

- A
   - B
`, "MM003");
  });

  it("rejects duplicate direction sections", () => {
    expectCode(`# Map

## Right

- A

## Right

- B
`, "MM015");
  });

  it("rejects a second H1", () => {
    expectCode(`# Map

- A

# Other
`, "MM020");
  });

  it("rejects non-canonical heading spacing", () => {
    expectCode(`#  Map

- A
`, "MM016");
  });

  it("rejects trailing spaces on structural lines", () => {
    expectCode(`# Map 

- A
`, "MM018");
  });

  it("rejects empty list items written with only a separator space", () => {
    expectCode(`# Map

- 
`, "MM018");
  });

  it("rejects CRLF", () => {
    expectCode("# Map\r\n\r\n- A\r\n", "MM018");
  });

  it("rejects control characters in node text", () => {
    expectCode(`# Map

- A\u0007
`, "MM019");
  });
});
