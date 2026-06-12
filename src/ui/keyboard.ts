export type KeyboardCompositionEventLike = {
  key?: string;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

export function isImeComposing(event: KeyboardCompositionEventLike): boolean {
  return (
    event.isComposing === true ||
    event.nativeEvent?.isComposing === true ||
    event.key === "Process" ||
    event.keyCode === 229 ||
    event.which === 229 ||
    event.nativeEvent?.keyCode === 229 ||
    event.nativeEvent?.which === 229
  );
}

export type NodeEditingShortcut =
  | "add-sibling"
  | "add-child"
  | "exit-editing"
  | "focus-previous"
  | "focus-parent"
  | "move-up"
  | "move-down"
  | "delete";

export function getNodeEditingShortcut(
  event: KeyboardCompositionEventLike
): NodeEditingShortcut | null {
  if (isImeComposing(event)) {
    return null;
  }

  if (event.key === "Enter" && event.shiftKey) {
    return "focus-previous";
  }

  if (event.key === "Enter") {
    return "add-sibling";
  }

  if (event.key === "Escape") {
    return "exit-editing";
  }

  if (event.key === "Tab") {
    return event.shiftKey ? "focus-parent" : "add-child";
  }

  if ((event.metaKey || event.altKey) && event.key === "ArrowUp") {
    return "move-up";
  }

  if ((event.metaKey || event.altKey) && event.key === "ArrowDown") {
    return "move-down";
  }

  if (
    (event.metaKey || event.altKey) &&
    (event.key === "Backspace" || event.key === "Delete")
  ) {
    return "delete";
  }

  return null;
}
