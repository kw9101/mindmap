import { describe, expect, it } from "vitest";
import { isImeComposing } from "./keyboard";

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
