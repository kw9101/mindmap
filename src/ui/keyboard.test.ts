import { describe, expect, it } from "vitest";
import { getNodeEditingShortcut, isImeComposing } from "./keyboard";

describe("keyboard IME guards", () => {
  it("detects standard composing keyboard events", () => {
    expect(isImeComposing({ isComposing: true, key: "Enter" })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true }, key: "Tab" })).toBe(
      true
    );
  });

  it("detects process and keyCode 229 IME events", () => {
    expect(isImeComposing({ key: "Process" })).toBe(true);
    expect(isImeComposing({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(isImeComposing({ key: "Enter", nativeEvent: { keyCode: 229 } })).toBe(
      true
    );
  });

  it("does not block ordinary shortcuts after composition ends", () => {
    expect(isImeComposing({ key: "Enter", nativeEvent: { isComposing: false } })).toBe(
      false
    );
    expect(isImeComposing({ key: "Tab", keyCode: 9 })).toBe(false);
  });
});

describe("node editing shortcuts", () => {
  it("uses Tab to add a child while editing", () => {
    expect(getNodeEditingShortcut({ key: "Tab" })).toBe("add-child");
  });

  it("keeps Shift+Tab as an explicit outdent shortcut", () => {
    expect(getNodeEditingShortcut({ key: "Tab", shiftKey: true })).toBe("outdent");
  });

  it("does not run node shortcuts during IME composition", () => {
    expect(getNodeEditingShortcut({ key: "Tab", isComposing: true })).toBeNull();
    expect(getNodeEditingShortcut({ key: "Enter", keyCode: 229 })).toBeNull();
  });
});
