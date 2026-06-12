export type KeyboardCompositionEventLike = {
  key?: string;
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
