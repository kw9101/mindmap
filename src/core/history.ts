export type HistoryEntry<T> = {
  label: string;
  value: T;
};

export type HistoryState<T> = {
  past: HistoryEntry<T>[];
  present: HistoryEntry<T>;
  future: HistoryEntry<T>[];
};

export function createHistory<T>(initialValue: T, label = "Initial state"): HistoryState<T> {
  return {
    past: [],
    present: { label, value: initialValue },
    future: []
  };
}

export function commitHistory<T>(
  history: HistoryState<T>,
  nextValue: T,
  label: string,
  isEqual: (left: T, right: T) => boolean = Object.is
): HistoryState<T> {
  if (isEqual(history.present.value, nextValue)) {
    return history;
  }

  return {
    past: [...history.past, history.present],
    present: { label, value: nextValue },
    future: []
  };
}

export function replacePresent<T>(
  history: HistoryState<T>,
  nextValue: T,
  label = history.present.label
): HistoryState<T> {
  return {
    ...history,
    present: { label, value: nextValue }
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past[history.past.length - 1];
  if (!previous) {
    return history;
  }

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const next = history.future[0];
  if (!next) {
    return history;
  }

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1)
  };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}
