import { describe, expect, it } from "vitest";
import { normalizeMindmapSource } from "./normalizer";

describe("normalizeMindmapSource", () => {
  it("repairs explicit file-shape issues and serializes canonical markdown", () => {
    const result = normalizeMindmapSource("# Map \r\n\r\n- \r\n\r\n");

    expect(result).toEqual({
      ok: true,
      source: "# Map\n\n-\n",
      changed: true
    });
  });

  it("preserves trailing spaces inside node text", () => {
    const source = "# Map\n\n- A \n";
    const result = normalizeMindmapSource(source);

    expect(result).toEqual({
      ok: true,
      source,
      changed: false
    });
  });

  it("returns diagnostics for unsupported structural repairs", () => {
    const result = normalizeMindmapSource("# Map\n\n1. A\n");

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "MM009" }]
    });
  });
});
