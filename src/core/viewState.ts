export type MarkdownPanelPosition = "bottom" | "left" | "right";

export type MindmapViewState = {
  selectedNodePath: string;
  selectedNodePaths: string[];
  selectionAnchorPath: string | null;
  editingNodePath: string | null;
  collapsedNodePaths: string[];
  zoom: number;
  pan: { x: number; y: number };
  markdownPanel: {
    position: MarkdownPanelPosition;
    size: number;
    hidden: boolean;
  };
};

export const viewStateKey = "view_state";
export const minZoom = 0.5;
export const maxZoom = 2;
export const zoomStep = 0.1;
export const panNudgeStep = 8;
export const minMarkdownPanelSize = 220;
export const maxMarkdownPanelSize = 640;
export const markdownPanelSizeStep = 20;
const defaultMarkdownPanelSize = 320;
const minPan = -20000;
const maxPan = 20000;

export function createDefaultViewState(selectedNodePath = ""): MindmapViewState {
  return {
    selectedNodePath,
    selectedNodePaths: selectedNodePath ? [selectedNodePath] : [],
    selectionAnchorPath: selectedNodePath || null,
    editingNodePath: selectedNodePath || null,
    collapsedNodePaths: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    markdownPanel: {
      position: "left",
      size: defaultMarkdownPanelSize,
      hidden: false
    }
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
    const selectedNodePath =
      typeof parsed.selectedNodePath === "string"
        ? parsed.selectedNodePath
        : fallbackPath;
    const selectedNodePaths = Array.isArray(parsed.selectedNodePaths)
      ? parsed.selectedNodePaths.filter(
          (path): path is string => typeof path === "string"
        )
      : selectedNodePath
        ? [selectedNodePath]
        : [];

    return {
      selectedNodePath,
      selectedNodePaths,
      selectionAnchorPath:
        typeof parsed.selectionAnchorPath === "string"
          ? parsed.selectionAnchorPath
          : selectedNodePath || null,
      editingNodePath:
        typeof parsed.editingNodePath === "string" || parsed.editingNodePath === null
          ? parsed.editingNodePath
          : fallbackPath || null,
      collapsedNodePaths: Array.isArray(parsed.collapsedNodePaths)
        ? parsed.collapsedNodePaths.filter(
            (path): path is string => typeof path === "string"
          )
        : [],
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
      },
      markdownPanel: {
        position: parseMarkdownPanelPosition(parsed.markdownPanel?.position),
        size:
          typeof parsed.markdownPanel?.size === "number" &&
          Number.isFinite(parsed.markdownPanel.size)
            ? clampMarkdownPanelSize(parsed.markdownPanel.size)
            : defaultMarkdownPanelSize,
        hidden: parsed.markdownPanel?.hidden === true
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

export function clampMarkdownPanelSize(size: number): number {
  return Math.round(
    Math.min(maxMarkdownPanelSize, Math.max(minMarkdownPanelSize, size))
  );
}

export function formatZoom(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

export function formatPan(pan: MindmapViewState["pan"]): string {
  return `X ${Math.round(pan.x)} Y ${Math.round(pan.y)}`;
}

function clampZoom(zoom: number): number {
  return Math.round(Math.min(maxZoom, Math.max(minZoom, zoom)) * 100) / 100;
}

function clampPanValue(value: number): number {
  return Math.round(Math.min(maxPan, Math.max(minPan, value)));
}

function parseMarkdownPanelPosition(
  position: unknown
): MarkdownPanelPosition {
  return position === "left" || position === "right" || position === "bottom"
    ? position
    : "left";
}
