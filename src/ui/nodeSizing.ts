const nodeSizing = {
  paddingPx: 36,
  charPx: 8.5,
  nodeMinPx: 64,
  nodeMaxPx: 340,
  rootMinPx: 84,
  rootMaxPx: 320
} as const;

export function getNodeInputWidth(text: string): number {
  return getInputWidth(text, nodeSizing.nodeMinPx, nodeSizing.nodeMaxPx);
}

export function getRootInputWidth(text: string): number {
  return getInputWidth(text, nodeSizing.rootMinPx, nodeSizing.rootMaxPx);
}

function getInputWidth(text: string, minPx: number, maxPx: number): number {
  const estimatedTextPx = estimateTextUnits(text) * nodeSizing.charPx;
  return clamp(Math.ceil(estimatedTextPx + nodeSizing.paddingPx), minPx, maxPx);
}

function estimateTextUnits(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return Array.from(text).reduce((units, character) => units + characterUnits(character), 0);
}

function characterUnits(character: string): number {
  if (character === " ") {
    return 0.55;
  }

  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/u.test(character)) {
    return 1.75;
  }

  if (/[mwMW@#%&]/u.test(character)) {
    return 1.25;
  }

  if (/[ilI.,:;'`|!]/u.test(character)) {
    return 0.55;
  }

  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
