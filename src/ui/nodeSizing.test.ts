import { describe, expect, it } from "vitest";
import { getNodeInputWidth, getRootInputWidth } from "./nodeSizing";

describe("node input sizing", () => {
  it("keeps empty nodes compact", () => {
    expect(getNodeInputWidth("")).toBe(64);
  });

  it("grows with visible text length", () => {
    expect(getNodeInputWidth("short")).toBeGreaterThan(getNodeInputWidth(""));
    expect(getNodeInputWidth("a much longer node title")).toBeGreaterThan(
      getNodeInputWidth("short")
    );
  });

  it("accounts for wider Korean text", () => {
    expect(getNodeInputWidth("마인드맵")).toBeGreaterThan(getNodeInputWidth("map"));
  });

  it("caps long node and root widths", () => {
    const longText = "x".repeat(200);

    expect(getNodeInputWidth(longText)).toBe(340);
    expect(getRootInputWidth(longText)).toBe(320);
  });
});
