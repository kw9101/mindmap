import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  redoHistory,
  replacePresent,
  undoHistory
} from "./history";

describe("history", () => {
  it("records every distinct commit as its own undo unit", () => {
    let history = createHistory("", "empty");

    history = commitHistory(history, "ㅎ", "type ㅎ");
    history = commitHistory(history, "하", "type ㅏ");
    history = commitHistory(history, "한", "type ㄴ");

    expect(history.present.value).toBe("한");
    history = undoHistory(history);
    expect(history.present.value).toBe("하");
    history = undoHistory(history);
    expect(history.present.value).toBe("ㅎ");
    history = undoHistory(history);
    expect(history.present.value).toBe("");
  });

  it("clears redo entries after a new commit", () => {
    let history = createHistory("A");

    history = commitHistory(history, "B", "B");
    history = commitHistory(history, "C", "C");
    history = undoHistory(history);
    expect(canRedo(history)).toBe(true);

    history = commitHistory(history, "D", "D");

    expect(history.present.value).toBe("D");
    expect(canRedo(history)).toBe(false);
  });

  it("supports redo after undo", () => {
    let history = createHistory("A");

    history = commitHistory(history, "B", "B");
    history = undoHistory(history);
    history = redoHistory(history);

    expect(history.present.value).toBe("B");
    expect(canUndo(history)).toBe(true);
  });

  it("can replace the current value without adding an undo step", () => {
    let history = createHistory("A");

    history = replacePresent(history, "A*");

    expect(history.present.value).toBe("A*");
    expect(canUndo(history)).toBe(false);
  });

  it("skips commits that are equal to the current value", () => {
    const history = createHistory({ value: "A" });
    const next = commitHistory(
      history,
      { value: "A" },
      "same",
      (left, right) => left.value === right.value
    );

    expect(next).toBe(history);
  });
});
