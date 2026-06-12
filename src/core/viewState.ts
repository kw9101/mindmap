export type MindmapViewState = {
  selectedNodePath: string;
  editingNodePath: string | null;
  zoom: number;
  pan: { x: number; y: number };
};

export const viewStateKey = "view_state";
export const minZoom = 0.5;
export const maxZoom = 2;
export const zoomStep = 0.1;
const minPan = -20000;
const maxPan = 20000;

export function createDefaultViewState(selectedNodePath = ""): MindmapViewState {
  return {
    selectedNodePath,
    editingNodePath: selectedNodePath || null,
    zoom: 1,
    pan: { x: 0, y: 0 }
  };
}

export function serializeViewState(viewState: MindmapViewState): string {
  return JSON.stringify(viewState);
}

export function parseViewState(value: string | null, fallbackPath = ""): MindmapViewState {
  if (value === null) {
    return createDefaultViewState(fallbackPath);
  }

  try {
    const parsed = JSON.parse(value) as Partial<MindmapViewState>;
    return {
      selectedNodePath:
        typeof parsed.selectedNodePath === "string"
          ? parsed.selectedNodePath
          : fallbackPath,
      editingNodePath:
        typeof parsed.editingNodePath === "string" || parsed.editingNodePath === null
          ? parsed.editingNodePath
          : fallbackPath || null,
      zoom:
        typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
          ? clampZoom(parsed.zoom)
          : 1,
      pan: {
        x:
          typeof parsed.pan?.x === "number" && Number.isFinite(parsed.pan.x)
            ? clampPanValue(parsed.pan.x)
            : 0,
        y:
          typeof parsed.pan?.y === "number" && Number.isFinite(parsed.pan.y)
            ? clampPanValue(parsed.pan.y)
            : 0
      }
    };
  } catch {
    return createDefaultViewState(fallbackPath);
  }
}

export function zoomIn(currentZoom: number): number {
  return clampZoom(currentZoom + zoomStep);
}

export function zoomOut(currentZoom: number): number {
  return clampZoom(currentZoom - zoomStep);
}

export function resetZoom(): number {
  return 1;
}

export function panBy(
  currentPan: MindmapViewState["pan"],
  deltaX: number,
  deltaY: number
): MindmapViewState["pan"] {
  return {
    x: clampPanValue(currentPan.x + deltaX),
    y: clampPanValue(currentPan.y + deltaY)
  };
}

export function resetPan(): MindmapViewState["pan"] {
  return { x: 0, y: 0 };
}

export function formatZoom(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

function clampZoom(zoom: number): number {
  return Math.round(Math.min(maxZoom, Math.max(minZoom, zoom)) * 100) / 100;
}

function clampPanValue(value: number): number {
  return Math.round(Math.min(maxPan, Math.max(minPan, value)));
}
