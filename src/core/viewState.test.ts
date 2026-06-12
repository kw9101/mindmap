import { describe, expect, it } from "vitest";
import {
  createDefaultViewState,
  formatZoom,
  parseViewState,
  panBy,
  resetPan,
  resetZoom,
  serializeViewState,
  zoomIn,
  zoomOut
} from "./viewState";

describe("view state", () => {
  it("serializes view state as app-only JSON for SQLite", () => {
    const viewState = createDefaultViewState("right/0");

    expect(JSON.parse(serializeViewState(viewState))).toEqual({
      selectedNodePath: "right/0",
      editingNodePath: "right/0",
      zoom: 1,
      pan: { x: 0, y: 0 }
    });
  });

  it("falls back when stored SQLite state is missing or corrupt", () => {
    expect(parseViewState(null, "right/0")).toMatchObject({
      selectedNodePath: "right/0"
    });
    expect(parseViewState("{", "right/1")).toMatchObject({
      selectedNodePath: "right/1"
    });
  });

  it("sanitizes optional fields when loading", () => {
    const loaded = parseViewState(
      JSON.stringify({
        selectedNodePath: "right/2",
        editingNodePath: null,
        zoom: 3,
        pan: { x: 30000.4, y: Number.NaN }
      }),
      "right/0"
    );

    expect(loaded).toEqual({
      selectedNodePath: "right/2",
      editingNodePath: null,
      zoom: 2,
      pan: { x: 20000, y: 0 }
    });
  });

  it("changes zoom in fixed clamped steps", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomIn(2)).toBe(2);
    expect(zoomOut(0.5)).toBe(0.5);
    expect(resetZoom()).toBe(1);
    expect(formatZoom(1.234)).toBe("123%");
  });

  it("changes pan in rounded clamped pixel deltas", () => {
    expect(panBy({ x: 0, y: 0 }, 12.4, -8.6)).toEqual({ x: 12, y: -9 });
    expect(panBy({ x: 19999, y: -19999 }, 20, -20)).toEqual({
      x: 20000,
      y: -20000
    });
    expect(resetPan()).toEqual({ x: 0, y: 0 });
  });
});
