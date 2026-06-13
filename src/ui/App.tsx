import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent
} from "react";
import {
  applyExternalSnapshot,
  chooseAppVersion,
  chooseDiskVersion,
  createUntitledDocument,
  editDocument,
  markSaveFailed,
  markSaved,
  markSaveStarted,
  openDocument,
  type DocumentState,
  type FileSnapshot
} from "../core/document";
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  redoHistory,
  replacePresent,
  undoHistory,
  type HistoryState
} from "../core/history";
import type { Diagnostic } from "../core/diagnostics";
import type { Direction, Mindmap, MindmapNode } from "../core/model";
import { parseClipboardNodes, serializeNodesForClipboard } from "../core/clipboard";
import { normalizeMindmapSource } from "../core/normalizer";
import { parseMindmap } from "../core/parser";
import { serializeMindmap } from "../core/serializer";
import {
  addChildNode,
  addPreviousSiblingNode,
  addRootNode,
  addSiblingNode,
  cloneNodesForPaths,
  deleteNode,
  deleteNodes,
  findNode,
  flattenNodes,
  firstNodePath,
  insertSiblingNodes,
  isRootNodePath,
  moveNodeByDirection,
  moveNodesByDirection,
  moveNodeTo,
  nextSiblingNodePath,
  parentNodePath,
  previousNodePath,
  previousSiblingNodePath,
  rootNodePath,
  selectedTopLevelNodePaths,
  type NodeMoveDirection,
  type NodeMovePosition,
  updateNodeText,
  updateRootTitle
} from "../core/tree";
import {
  createDefaultViewState,
  formatPan,
  formatZoom,
  panBy,
  panNudgeStep,
  parseViewState,
  resetPan,
  resetZoom,
  serializeViewState,
  viewStateKey,
  type MindmapViewState,
  zoomIn,
  zoomOut
} from "../core/viewState";
import {
  isNativeAvailable,
  listenMarkdownFileChanged,
  openExternalDiff,
  pickOpenMarkdownPath,
  pickSaveMarkdownPath,
  readAppState,
  readClipboardText,
  readMarkdownFile,
  unwatchMarkdownFile,
  watchMarkdownFile,
  writeClipboardText,
  writeAppState,
  writeMarkdownFileAtomic,
  type DiffFiles
} from "../platform/native";
import { getNodeEditingShortcut, isImeComposing } from "./keyboard";
import { getNodeInputWidth, getRootInputWidth } from "./nodeSizing";

const autosaveDelayMs = 700;
const externalPollMs = 2500;
const nodeDragStartThresholdPx = 6;
const nodeDropSnapDistancePx = 96;
const clickMoveTolerancePx = 4;

type ConnectorPath = {
  id: string;
  d: string;
};

type SearchMatch = {
  path: string;
};

type CommandPaletteCommand = {
  id: string;
  title: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
  keywords?: string[];
  run: () => void | Promise<void>;
};

type KeyboardShortcutGroup = {
  title: string;
  shortcuts: { keys: string; action: string }[];
};

type FocusedNodeTarget = {
  path: string;
  editing: boolean;
};

type SpatialDirection = NodeMoveDirection;

type NodeDropTarget = {
  sourcePath: string;
  targetPath: string;
  position: NodeMovePosition;
  rootDirection?: Direction;
};

type NodeDragSession = {
  pointerId: number;
  sourcePath: string;
  startX: number;
  startY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  previewText: string;
  previewWidth: number;
  previewHeight: number;
  active: boolean;
};

type NodeDragPreview = {
  sourcePath: string;
  text: string;
  x: number;
  y: number;
  width: number;
  minHeight: number;
};

type NodeDragSnapLine = {
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

const keyboardShortcutGroups: KeyboardShortcutGroup[] = [
  {
    title: "편집 중",
    shortcuts: [
      { keys: "Enter", action: "다음 형제로 이동 또는 생성" },
      { keys: "Cmd/Ctrl+Enter", action: "아래 형제 노드 추가" },
      { keys: "Shift+Enter", action: "위 형제로 이동 또는 생성" },
      { keys: "Tab", action: "첫 자식으로 이동 또는 생성" },
      { keys: "Shift+Tab", action: "부모 노드 편집" },
      { keys: "Esc", action: "선택 모드로 전환" },
      { keys: "Cmd/Ctrl+Arrow", action: "노드를 해당 방향으로 이동" },
      { keys: "Option/Cmd+Backspace", action: "노드 삭제" }
    ]
  },
  {
    title: "선택 모드",
    shortcuts: [
      { keys: "ArrowUp/Down", action: "화면상 위/아래 노드 선택" },
      { keys: "ArrowLeft/Right", action: "화면상 왼쪽/오른쪽 노드 선택" },
      { keys: "Shift+Arrow", action: "범위 선택 확장" },
      { keys: "Enter", action: "편집 시작" },
      { keys: "Cmd/Ctrl+Enter", action: "아래 형제 노드 추가" },
      { keys: "Tab", action: "첫 자식으로 이동 또는 생성" },
      { keys: "Shift+Tab", action: "부모 노드 선택" },
      { keys: "Space", action: "자식 접기/펼치기" },
      { keys: "Cmd/Ctrl+Click", action: "선택 추가/해제" },
      { keys: "Shift+Click", action: "범위 선택" },
      { keys: "Cmd/Ctrl+Arrow", action: "노드를 해당 방향으로 이동" },
      { keys: "Backspace/Delete", action: "노드 삭제" },
      { keys: "Cmd/Ctrl+C", action: "선택 subtree 복사" },
      { keys: "Cmd/Ctrl+X", action: "선택 subtree 잘라내기" },
      { keys: "Cmd/Ctrl+V", action: "붙여넣기" }
    ]
  },
  {
    title: "문서/보기",
    shortcuts: [
      { keys: "Cmd/Ctrl+O", action: "Markdown 파일 열기" },
      { keys: "Cmd/Ctrl+S", action: "저장" },
      { keys: "Cmd/Ctrl+Z", action: "Undo" },
      { keys: "Cmd/Ctrl+Shift+Z", action: "Redo" },
      { keys: "Cmd/Ctrl+Y", action: "Redo" },
      { keys: "Cmd/Ctrl+F", action: "노드 검색" },
      { keys: "Cmd/Ctrl+K 또는 Cmd/Ctrl+Shift+P", action: "커맨드 팔렛트" },
      { keys: "Normalize", action: "Markdown 정규화" },
      { keys: "Cmd/Ctrl++", action: "확대" },
      { keys: "Cmd/Ctrl+-", action: "축소" },
      { keys: "Cmd/Ctrl+0", action: "100%" },
      { keys: "노드 드래그", action: "노드 재배치" },
      { keys: "마우스 휠", action: "확대/축소" },
      { keys: "? 또는 Cmd/Ctrl+/", action: "키바인딩 도움말" }
    ]
  }
];

export function App() {
  const [history, setHistory] = useState<HistoryState<DocumentState>>(() =>
    createHistory(createUntitledDocument())
  );
  const [viewState, setViewState] = useState<MindmapViewState>(() =>
    createDefaultViewState()
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFiles | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [nodeDropTarget, setNodeDropTarget] = useState<NodeDropTarget | null>(null);
  const [nodeDragPreview, setNodeDragPreview] = useState<NodeDragPreview | null>(
    null
  );
  const [nodeDragSnapLine, setNodeDragSnapLine] = useState<NodeDragSnapLine | null>(
    null
  );
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPath[]>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pan: MindmapViewState["pan"];
  } | null>(null);
  const nodeDragRef = useRef<NodeDragSession | null>(null);

  const activeDocument = history.present.value;
  const parseResult = useMemo(
    () => parseMindmap(activeDocument.source),
    [activeDocument.source]
  );
  const mindmap = parseResult.ok ? parseResult.mindmap : null;
  const nativeAvailable = isNativeAvailable();
  const fileName = activeDocument.file?.name ?? "untitled.md";
  const status = statusLabel(activeDocument, nativeAvailable);
  const selectedNodePaths = useMemo(
    () => selectionPathsForMindmap(mindmap, viewState),
    [mindmap, viewState]
  );
  const collapsedNodePaths = useMemo(
    () => collapsedPathsForMindmap(mindmap, viewState.collapsedNodePaths),
    [mindmap, viewState.collapsedNodePaths]
  );
  const collapsedPathSet = useMemo(
    () => new Set(collapsedNodePaths),
    [collapsedNodePaths]
  );
  const selectedClipboardPaths = useMemo(
    () => (mindmap ? selectedTopLevelNodePaths(mindmap, selectedNodePaths) : []),
    [mindmap, selectedNodePaths]
  );
  const selectedClipboardNodes = useMemo(
    () => (mindmap ? cloneNodesForPaths(mindmap, selectedClipboardPaths) : []),
    [mindmap, selectedClipboardPaths]
  );
  const searchMatches = useMemo(
    () => (mindmap ? searchNodePaths(mindmap, searchQuery) : []),
    [mindmap, searchQuery]
  );
  const searchMatchPaths = useMemo(
    () => new Set(searchMatches.map((match) => match.path)),
    [searchMatches]
  );
  const currentSearchIndex =
    searchMatches.length === 0 ? -1 : Math.min(searchCursor, searchMatches.length - 1);
  const currentSearchPath =
    currentSearchIndex === -1 ? null : searchMatches[currentSearchIndex]?.path ?? null;
  const searchStatusText =
    searchMatches.length === 0 ? "0/0" : `${currentSearchIndex + 1}/${searchMatches.length}`;
  const selectedDocumentNode =
    mindmap && !isRootNodePath(viewState.selectedNodePath)
      ? findNode(mindmap, viewState.selectedNodePath)
      : null;

  const replaceDocument = useCallback((nextDocument: DocumentState, label: string) => {
    setHistory((current) => replacePresent(current, nextDocument, label));
  }, []);

  const commitSource = useCallback(
    (source: string, label: string) => {
      const nextResult = parseMindmap(source);
      if (!nextResult.ok) {
        setNotice(
          formatParseFailureNotice(
            "내부 편집 결과를 Markdown으로 적용하지 못했습니다.",
            nextResult.diagnostics,
            source
          )
        );
        return;
      }

      setHistory((current) =>
        commitHistory(
          current,
          editDocument(current.present.value, source),
          label,
          documentsEqual
        )
      );
      setDiffFiles(null);
    },
    []
  );

  const commitMindmap = useCallback(
    (
      nextMindmap: Mindmap,
      label: string,
      nextSelectedPath?: string,
      editing = nextSelectedPath !== undefined && nextSelectedPath !== ""
    ) => {
      commitSource(serializeMindmap(nextMindmap), label);
      if (nextSelectedPath !== undefined) {
        setViewState((current) => ({
          ...current,
          selectedNodePath: nextSelectedPath,
          selectedNodePaths: nextSelectedPath ? [nextSelectedPath] : [],
          selectionAnchorPath: nextSelectedPath || null,
          editingNodePath: editing && nextSelectedPath ? nextSelectedPath : null
        }));
      }
    },
    [commitSource]
  );

  const selectNode = useCallback((path: string, editing: boolean) => {
    setViewState((current) => ({
      ...current,
      selectedNodePath: path,
      selectedNodePaths: path ? [path] : [],
      selectionAnchorPath: path || null,
      editingNodePath: editing ? path : null
    }));
  }, []);

  const selectNodeAndFocus = useCallback(
    (path: string, editing: boolean) => {
      selectNode(path, editing);
      focusNodeElementOnNextFrame(path);
    },
    [selectNode]
  );

  useEffect(() => {
    setSearchCursor((current) =>
      searchMatches.length === 0 ? 0 : Math.min(current, searchMatches.length - 1)
    );
  }, [searchMatches.length]);

  const focusSearchMatchAtIndex = useCallback(
    (index: number) => {
      const match = searchMatches[index];
      if (!match) {
        return;
      }

      setSearchCursor(index);
      setViewState((current) => ({
        ...current,
        selectedNodePath: match.path,
        selectedNodePaths: [match.path],
        selectionAnchorPath: match.path,
        editingNodePath: null,
        collapsedNodePaths: current.collapsedNodePaths.filter(
          (path) => !isDescendantPath(match.path, path)
        )
      }));
      focusNodeElementOnNextFrame(match.path);
    },
    [searchMatches]
  );

  const focusSearchMatch = useCallback(
    (direction: "next" | "previous") => {
      if (searchMatches.length === 0) {
        return;
      }

      const nextIndex =
        currentSearchIndex === -1
          ? direction === "next"
            ? 0
            : searchMatches.length - 1
          : direction === "next"
            ? (currentSearchIndex + 1) % searchMatches.length
            : (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length;
      focusSearchMatchAtIndex(nextIndex);
    },
    [currentSearchIndex, focusSearchMatchAtIndex, searchMatches.length]
  );

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const selectNodeRange = useCallback(
    (path: string) => {
      if (!mindmap || isRootNodePath(path)) {
        selectNode(path, false);
        return;
      }

      setViewState((current) => {
        const anchor =
          current.selectionAnchorPath &&
          !isRootNodePath(current.selectionAnchorPath) &&
          findNode(mindmap, current.selectionAnchorPath)
            ? current.selectionAnchorPath
            : current.selectedNodePath;
        const range = rangeSelectionPaths(mindmap, collapsedPathSet, anchor, path);
        return {
          ...current,
          selectedNodePath: path,
          selectedNodePaths: range,
          selectionAnchorPath: anchor,
          editingNodePath: null
        };
      });
    },
    [collapsedPathSet, mindmap, selectNode]
  );

  const toggleNodeSelection = useCallback(
    (path: string) => {
      if (!mindmap || isRootNodePath(path)) {
        selectNode(path, false);
        return;
      }

      setViewState((current) => {
        const currentSelection = selectionPathsForMindmap(mindmap, current).filter(
          (item) => !isRootNodePath(item)
        );
        const selected = new Set(currentSelection);
        if (selected.has(path) && selected.size > 1) {
          selected.delete(path);
        } else {
          selected.add(path);
        }

        const nextSelection = orderSelectionPaths(mindmap, Array.from(selected));
        const nextPrimary = selected.has(path) ? path : nextSelection[0] ?? path;
        return {
          ...current,
          selectedNodePath: nextPrimary,
          selectedNodePaths: nextSelection,
          selectionAnchorPath: nextPrimary,
          editingNodePath: null
        };
      });
    },
    [mindmap, selectNode]
  );

  const toggleCollapsedNode = useCallback(
    (path: string) => {
      if (!mindmap || isRootNodePath(path)) {
        return;
      }

      const node = findNode(mindmap, path);
      if (!node || node.children.length === 0) {
        return;
      }

      setViewState((current) => {
        const collapsed = new Set(current.collapsedNodePaths);
        if (collapsed.has(path)) {
          collapsed.delete(path);
        } else {
          collapsed.add(path);
        }

        return {
          ...current,
          collapsedNodePaths: orderSelectionPaths(mindmap, Array.from(collapsed))
        };
      });
    },
    [mindmap]
  );

  const expandNode = useCallback((path: string) => {
    setViewState((current) =>
      current.collapsedNodePaths.includes(path)
        ? {
            ...current,
            collapsedNodePaths: current.collapsedNodePaths.filter((item) => item !== path)
          }
        : current
    );
  }, []);

  const moveFocusedNode = useCallback(
    (path: string, direction: NodeMoveDirection, editing: boolean) => {
      if (!mindmap) {
        return false;
      }

      const result = moveNodeByDirection(mindmap, path, direction);
      if (!result) {
        return false;
      }

      commitMindmap(result.mindmap, "Move node", result.movedPath, editing);
      return true;
    },
    [commitMindmap, mindmap]
  );

  const moveSelectedNodes = useCallback(
    (direction: NodeMoveDirection) => {
      if (!mindmap) {
        return false;
      }

      const result =
        selectedClipboardPaths.length > 1
          ? moveNodesByDirection(mindmap, selectedClipboardPaths, direction)
          : moveNodesByDirection(mindmap, [viewState.selectedNodePath], direction);
      if (!result) {
        return false;
      }

      const primaryIndex = selectedClipboardPaths.includes(viewState.selectedNodePath)
        ? selectedClipboardPaths.indexOf(viewState.selectedNodePath)
        : 0;
      const nextPrimary =
        result.movedPaths[Math.min(primaryIndex, result.movedPaths.length - 1)] ??
        result.movedPaths[0];
      commitMindmap(result.mindmap, "Move nodes", nextPrimary, false);
      setViewState((current) => ({
        ...current,
        selectedNodePath: nextPrimary,
        selectedNodePaths: result.movedPaths,
        selectionAnchorPath: result.movedPaths[0] ?? nextPrimary,
        editingNodePath: null
      }));
      return true;
    },
    [
      commitMindmap,
      mindmap,
      selectedClipboardPaths,
      viewState.selectedNodePath
    ]
  );

  const exitEditingIfCurrent = useCallback((path: string) => {
    setViewState((current) =>
      current.editingNodePath === path
        ? {
            ...current,
            selectedNodePath: path,
            selectedNodePaths: path ? [path] : [],
            selectionAnchorPath: path || null,
            editingNodePath: null
          }
        : current
    );
  }, []);

  const saveCurrent = useCallback(
    async (path: string) => {
      const sourceToSave = activeDocument.source;
      const validation = parseMindmap(sourceToSave);
      if (!validation.ok) {
        setNotice(
          formatParseFailureNotice(
            "저장 전에 Markdown 검증이 실패했습니다.",
            validation.diagnostics,
            sourceToSave
          )
        );
        return;
      }

      replaceDocument(markSaveStarted(activeDocument), "Saving");
      try {
        const snapshot = await writeMarkdownFileAtomic(path, sourceToSave);
        setHistory((current) => {
          const latest = current.present.value;
          const nextDocument =
            latest.source === sourceToSave
              ? markSaved(latest, snapshot)
              : markSaveFinishedWithNewerEdits(latest, snapshot, sourceToSave);
          return replacePresent(current, nextDocument, `Saved ${snapshot.name}`);
        });
        setNotice(`저장됨: ${snapshot.name}`);
      } catch (error) {
        setHistory((current) =>
          replacePresent(
            current,
            markSaveFailed(current.present.value, errorMessage(error)),
            "Save failed"
          )
        );
      }
    },
    [activeDocument, replaceDocument]
  );

  const handleOpen = useCallback(async () => {
    if (!nativeAvailable) {
      setNotice("파일 열기는 Tauri 데스크톱 실행에서 사용할 수 있습니다.");
      return;
    }

    const path = await pickOpenMarkdownPath();
    if (!path) {
      return;
    }

    try {
      const snapshot = await readMarkdownFile(path);
      const nextDocument = openDocument(snapshot);
      setHistory(createHistory(nextDocument, `Open ${snapshot.name}`));
      setDiffFiles(null);
      setNotice(`열림: ${snapshot.name}`);

      const openedResult = parseMindmap(snapshot.contents);
      const fallbackPath = openedResult.ok ? firstNodePath(openedResult.mindmap) : "";
      const storedViewState = await readAppState(snapshot.path, viewStateKey).catch(
        () => null
      );
      setViewState(parseViewState(storedViewState, fallbackPath));
    } catch (error) {
      setNotice(`파일을 열 수 없습니다: ${errorMessage(error)}`);
    }
  }, [nativeAvailable]);

  const handleSave = useCallback(async () => {
    if (!nativeAvailable) {
      setNotice("파일 저장은 Tauri 데스크톱 실행에서 사용할 수 있습니다.");
      return;
    }

    if (activeDocument.file) {
      await saveCurrent(activeDocument.file.path);
      return;
    }

    const path = await pickSaveMarkdownPath("untitled.md");
    if (path) {
      await saveCurrent(path);
    }
  }, [activeDocument.file, nativeAvailable, saveCurrent]);

  const handleSaveAs = useCallback(async () => {
    if (!nativeAvailable) {
      setNotice("다른 이름 저장은 Tauri 데스크톱 실행에서 사용할 수 있습니다.");
      return;
    }

    const path = await pickSaveMarkdownPath(activeDocument.file?.path ?? "untitled.md");
    if (path) {
      await saveCurrent(path);
    }
  }, [activeDocument.file?.path, nativeAvailable, saveCurrent]);

  const handleNormalizeMarkdown = useCallback(() => {
    const result = normalizeMindmapSource(activeDocument.source);
    if (!result.ok) {
      setNotice(
        formatParseFailureNotice(
          "Markdown을 정규화할 수 없습니다.",
          result.diagnostics,
          result.diagnosticSource
        )
      );
      return;
    }

    if (!result.changed) {
      setNotice("이미 정규화된 Markdown입니다.");
      return;
    }

    commitSource(result.source, "Normalize Markdown");
    setNotice("Markdown을 정규화했습니다.");
  }, [activeDocument.source, commitSource]);

  const handleUndo = useCallback(() => {
    setHistory((current) => {
      const next = undoHistory(current);
      return normalizeUndoAgainstDisk(current, next);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((current) => redoHistory(current));
  }, []);

  const handleZoomIn = useCallback(() => {
    setViewState((current) => ({
      ...current,
      zoom: zoomIn(current.zoom)
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewState((current) => ({
      ...current,
      zoom: zoomOut(current.zoom)
    }));
  }, []);

  const handleResetZoom = useCallback(() => {
    setViewState((current) => ({
      ...current,
      zoom: resetZoom()
    }));
  }, []);

  const handleResetPan = useCallback(() => {
    setViewState((current) => ({
      ...current,
      pan: resetPan()
    }));
  }, []);

  const handlePanNudge = useCallback((deltaX: number, deltaY: number) => {
    setViewState((current) => ({
      ...current,
      pan: panBy(current.pan, deltaX, deltaY)
    }));
  }, []);

  const handleAddRootNode = useCallback(
    (direction: Direction) => {
      if (!mindmap) {
        return;
      }

      const next = addRootNode(mindmap, direction);
      commitMindmap(
        next,
        direction === "right" ? "Add right root node" : "Add left root node",
        lastRootPath(next, direction)
      );
    },
    [commitMindmap, mindmap]
  );

  const handleViewportWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    setViewState((current) => ({
      ...current,
      zoom: event.deltaY < 0 ? zoomIn(current.zoom) : zoomOut(current.zoom)
    }));
  }, []);

  const handleViewportPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || isInteractivePanTarget(event.target)) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      panDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pan: viewState.pan
      };
      setIsPanning(true);
    },
    [viewState.pan]
  );

  const handleViewportPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setViewState((current) => ({
      ...current,
      pan: panBy(drag.pan, deltaX, deltaY)
    }));
  }, []);

  const stopViewportPan = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    panDragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const clearNodeDrag = useCallback(() => {
    nodeDragRef.current = null;
    setIsNodeDragging(false);
    setNodeDropTarget(null);
    setNodeDragPreview(null);
    setNodeDragSnapLine(null);
  }, []);

  const handleNodeDragPointerDown = useCallback(
    (path: string, event: PointerEvent<HTMLTextAreaElement>) => {
      if (
        event.button !== 0 ||
        isRootNodePath(path) ||
        viewState.editingNodePath === path
      ) {
        return;
      }

      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      nodeDragRef.current = {
        pointerId: event.pointerId,
        sourcePath: path,
        startX: event.clientX,
        startY: event.clientY,
        pointerOffsetX: event.clientX - rect.left,
        pointerOffsetY: event.clientY - rect.top,
        previewText: event.currentTarget.value,
        previewWidth: rect.width,
        previewHeight: rect.height,
        active: false
      };
      setNodeDropTarget(null);
      setNodeDragPreview(null);
      setNodeDragSnapLine(null);
      setIsNodeDragging(false);
    },
    [viewState.editingNodePath]
  );

  const handleNodeDragPointerMove = useCallback(
    (path: string, event: PointerEvent<HTMLTextAreaElement>) => {
      const drag = nodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.sourcePath !== path) {
        return;
      }

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.active && Math.hypot(deltaX, deltaY) < nodeDragStartThresholdPx) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (!drag.active) {
        drag.active = true;
        setIsNodeDragging(true);
        selectNode(drag.sourcePath, false);
      }

      const preview: NodeDragPreview = {
        sourcePath: drag.sourcePath,
        text: drag.previewText,
        x: event.clientX - drag.pointerOffsetX,
        y: event.clientY - drag.pointerOffsetY,
        width: drag.previewWidth,
        minHeight: drag.previewHeight
      };
      const dropTarget = nodeDropTargetFromPointer(
        workspaceRef.current,
        drag.sourcePath,
        event.clientX,
        event.clientY
      );

      setNodeDragPreview(preview);
      setNodeDropTarget(dropTarget);
      setNodeDragSnapLine(
        dropTarget
          ? createNodeDragSnapLine(workspaceRef.current, dropTarget, preview)
          : null
      );
    },
    [selectNode]
  );

  const handleNodeDragPointerUp = useCallback(
    (path: string, event: PointerEvent<HTMLTextAreaElement>) => {
      const drag = nodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.sourcePath !== path) {
        return;
      }

      event.stopPropagation();
      const wasActive = drag.active;
      const target =
        nodeDropTarget ??
        nodeDropTargetFromPointer(
          workspaceRef.current,
          drag.sourcePath,
          event.clientX,
          event.clientY
        );

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      clearNodeDrag();

      if (!wasActive || !target || !mindmap) {
        return;
      }

      const result = moveNodeTo(
        mindmap,
        drag.sourcePath,
        target.targetPath,
        target.position,
        target.rootDirection
      );
      if (result) {
        commitMindmap(result.mindmap, "Move node", result.movedPath, false);
      }
    },
    [clearNodeDrag, commitMindmap, mindmap, nodeDropTarget]
  );

  const handleNodeDragPointerCancel = useCallback(
    (path: string, event: PointerEvent<HTMLTextAreaElement>) => {
      const drag = nodeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.sourcePath !== path) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      clearNodeDrag();
    },
    [clearNodeDrag]
  );

  const handleCopySubtree = useCallback(async () => {
    if (!mindmap || selectedClipboardNodes.length === 0) {
      return;
    }

    try {
      await writeClipboardText(serializeNodesForClipboard(selectedClipboardNodes));
      setNotice(
        selectedClipboardNodes.length === 1
          ? "선택한 노드를 Markdown 목록으로 복사했습니다."
          : `선택한 노드 ${selectedClipboardNodes.length}개를 Markdown 목록으로 복사했습니다.`
      );
    } catch (error) {
      setNotice(`클립보드에 쓸 수 없습니다: ${errorMessage(error)}`);
    }
  }, [mindmap, selectedClipboardNodes]);

  const handleCutSubtree = useCallback(async () => {
    if (!mindmap || selectedClipboardNodes.length === 0) {
      return;
    }

    try {
      await writeClipboardText(serializeNodesForClipboard(selectedClipboardNodes));
    } catch (error) {
      setNotice(`클립보드에 쓸 수 없습니다: ${errorMessage(error)}`);
      return;
    }

    const fallback = previousNodePath(mindmap, viewState.selectedNodePath);
    const next = deleteNodes(mindmap, selectedClipboardPaths);
    commitMindmap(
      next,
      "Cut nodes",
      selectionPathAfterDelete(next, fallback),
      false
    );
    setNotice(
      selectedClipboardNodes.length === 1
        ? "선택한 노드를 잘라냈습니다."
        : `선택한 노드 ${selectedClipboardNodes.length}개를 잘라냈습니다.`
    );
  }, [
    commitMindmap,
    mindmap,
    selectedClipboardNodes,
    selectedClipboardPaths,
    viewState.selectedNodePath
  ]);

  const handlePasteSubtree = useCallback(async () => {
    if (!mindmap || !selectedDocumentNode) {
      return;
    }

    try {
      const text = await readClipboardText();
      const parsed = parseClipboardNodes(text, selectedDocumentNode.direction);
      if (!parsed.ok) {
        setNotice(
          formatParseFailureNotice(
            "붙여넣기 Markdown을 읽을 수 없습니다.",
            parsed.diagnostics,
            text
          )
        );
        return;
      }

      const next = insertSiblingNodes(mindmap, selectedDocumentNode.path, parsed.nodes);
      commitMindmap(next, "Paste nodes", nextSiblingNodePath(next, selectedDocumentNode.path));
    } catch (error) {
      setNotice(`클립보드에서 읽을 수 없습니다: ${errorMessage(error)}`);
    }
  }, [commitMindmap, mindmap, selectedDocumentNode]);

  const handleDeleteSelectedNodes = useCallback(() => {
    if (!mindmap || selectedClipboardPaths.length === 0) {
      return;
    }

    const fallback = previousNodePath(mindmap, viewState.selectedNodePath);
    const next = deleteNodes(mindmap, selectedClipboardPaths);
    commitMindmap(
      next,
      selectedClipboardPaths.length === 1 ? "Delete node" : "Delete nodes",
      selectionPathAfterDelete(next, fallback),
      false
    );
  }, [commitMindmap, mindmap, selectedClipboardPaths, viewState.selectedNodePath]);

  const handleEditSelectedNode = useCallback(() => {
    if (!viewState.selectedNodePath) {
      return;
    }

    selectNode(viewState.selectedNodePath, true);
  }, [selectNode, viewState.selectedNodePath]);

  const handleAddChildToSelectedNode = useCallback(() => {
    if (!mindmap || !viewState.selectedNodePath || isRootNodePath(viewState.selectedNodePath)) {
      return;
    }

    const next = addChildNode(mindmap, viewState.selectedNodePath);
    commitMindmap(next, "Add child node", lastChildPath(next, viewState.selectedNodePath));
  }, [commitMindmap, mindmap, viewState.selectedNodePath]);

  const handleAddSiblingAfterSelectedNode = useCallback(() => {
    if (!mindmap || !viewState.selectedNodePath || isRootNodePath(viewState.selectedNodePath)) {
      return;
    }

    const next = addSiblingNode(mindmap, viewState.selectedNodePath);
    commitMindmap(
      next,
      "Add sibling node",
      nextSiblingNodePath(next, viewState.selectedNodePath)
    );
  }, [commitMindmap, mindmap, viewState.selectedNodePath]);

  const handleToggleSelectedNodeCollapse = useCallback(() => {
    if (!viewState.selectedNodePath || isRootNodePath(viewState.selectedNodePath)) {
      return;
    }

    toggleCollapsedNode(viewState.selectedNodePath);
  }, [toggleCollapsedNode, viewState.selectedNodePath]);

  const openCommandPalette = useCallback(() => {
    setCommandPaletteQuery("");
    setShowCommandPalette(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const commandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () => [
      {
        id: "find-nodes",
        title: "Find nodes",
        detail: "검색창으로 이동",
        shortcut: "Cmd/Ctrl+F",
        disabled: !mindmap,
        keywords: ["search", "찾기", "검색"],
        run: focusSearchInput
      },
      {
        id: "next-search-match",
        title: "Next search match",
        detail: "다음 검색 결과로 이동",
        disabled: searchMatches.length === 0,
        keywords: ["find", "search", "next", "다음"],
        run: () => focusSearchMatch("next")
      },
      {
        id: "previous-search-match",
        title: "Previous search match",
        detail: "이전 검색 결과로 이동",
        disabled: searchMatches.length === 0,
        keywords: ["find", "search", "previous", "이전"],
        run: () => focusSearchMatch("previous")
      },
      {
        id: "open-file",
        title: "Open file",
        detail: "Markdown 파일 열기",
        shortcut: "Cmd/Ctrl+O",
        keywords: ["file", "open", "열기"],
        run: handleOpen
      },
      {
        id: "save-file",
        title: "Save",
        detail: "현재 Markdown 저장",
        shortcut: "Cmd/Ctrl+S",
        keywords: ["file", "save", "저장"],
        run: handleSave
      },
      {
        id: "save-as-file",
        title: "Save as",
        detail: "다른 이름으로 저장",
        keywords: ["file", "save", "저장"],
        run: handleSaveAs
      },
      {
        id: "normalize-markdown",
        title: "Normalize Markdown",
        detail: "Markdown 파일 형식 정규화",
        keywords: ["markdown", "format", "정규화"],
        run: handleNormalizeMarkdown
      },
      {
        id: "undo",
        title: "Undo",
        detail: "이전 변경 되돌리기",
        shortcut: "Cmd/Ctrl+Z",
        disabled: !canUndo(history),
        keywords: ["history", "되돌리기"],
        run: handleUndo
      },
      {
        id: "redo",
        title: "Redo",
        detail: "되돌린 변경 다시 적용",
        shortcut: "Cmd/Ctrl+Shift+Z",
        disabled: !canRedo(history),
        keywords: ["history", "다시"],
        run: handleRedo
      },
      {
        id: "edit-selected-node",
        title: "Edit selected node",
        detail: "선택 노드 편집 시작",
        disabled: !viewState.selectedNodePath,
        keywords: ["node", "edit", "편집"],
        run: handleEditSelectedNode
      },
      {
        id: "add-right-root-node",
        title: "Add right root node",
        detail: "오른쪽 루트 노드 추가",
        disabled: !mindmap,
        keywords: ["node", "add", "right", "추가", "오른쪽"],
        run: () => handleAddRootNode("right")
      },
      {
        id: "add-left-root-node",
        title: "Add left root node",
        detail: "왼쪽 루트 노드 추가",
        disabled: !mindmap,
        keywords: ["node", "add", "left", "추가", "왼쪽"],
        run: () => handleAddRootNode("left")
      },
      {
        id: "add-child-node",
        title: "Add child node",
        detail: "선택 노드 아래에 자식 추가",
        disabled:
          !mindmap || !viewState.selectedNodePath || isRootNodePath(viewState.selectedNodePath),
        keywords: ["node", "add", "child", "자식", "추가"],
        run: handleAddChildToSelectedNode
      },
      {
        id: "add-sibling-node",
        title: "Add sibling node",
        detail: "선택 노드 다음에 형제 추가",
        disabled:
          !mindmap || !viewState.selectedNodePath || isRootNodePath(viewState.selectedNodePath),
        keywords: ["node", "add", "sibling", "형제", "추가"],
        run: handleAddSiblingAfterSelectedNode
      },
      {
        id: "delete-selected-nodes",
        title: "Delete selected nodes",
        detail: "선택 노드 삭제",
        disabled: selectedClipboardPaths.length === 0,
        keywords: ["node", "delete", "삭제"],
        run: handleDeleteSelectedNodes
      },
      {
        id: "copy-selected-nodes",
        title: "Copy selected nodes",
        detail: "선택 subtree 복사",
        shortcut: "Cmd/Ctrl+C",
        disabled: !mindmap || selectedClipboardNodes.length === 0,
        keywords: ["clipboard", "copy", "복사"],
        run: handleCopySubtree
      },
      {
        id: "cut-selected-nodes",
        title: "Cut selected nodes",
        detail: "선택 subtree 잘라내기",
        shortcut: "Cmd/Ctrl+X",
        disabled: !mindmap || selectedClipboardNodes.length === 0,
        keywords: ["clipboard", "cut", "잘라내기"],
        run: handleCutSubtree
      },
      {
        id: "paste-nodes",
        title: "Paste nodes",
        detail: "선택 노드 다음에 붙여넣기",
        shortcut: "Cmd/Ctrl+V",
        disabled: !mindmap || !selectedDocumentNode,
        keywords: ["clipboard", "paste", "붙여넣기"],
        run: handlePasteSubtree
      },
      {
        id: "toggle-collapse",
        title: "Toggle selected collapse",
        detail: "선택 노드 접기/펼치기",
        disabled: !selectedDocumentNode || selectedDocumentNode.children.length === 0,
        keywords: ["node", "collapse", "expand", "접기", "펼치기"],
        run: handleToggleSelectedNodeCollapse
      },
      {
        id: "zoom-in",
        title: "Zoom in",
        detail: "캔버스 확대",
        shortcut: "Cmd/Ctrl++",
        keywords: ["view", "zoom", "확대"],
        run: handleZoomIn
      },
      {
        id: "zoom-out",
        title: "Zoom out",
        detail: "캔버스 축소",
        shortcut: "Cmd/Ctrl+-",
        keywords: ["view", "zoom", "축소"],
        run: handleZoomOut
      },
      {
        id: "reset-zoom",
        title: "Reset zoom",
        detail: "확대율 100%",
        shortcut: "Cmd/Ctrl+0",
        keywords: ["view", "zoom", "reset", "초기화"],
        run: handleResetZoom
      },
      {
        id: "center-pan",
        title: "Center canvas",
        detail: "pan 위치 초기화",
        keywords: ["view", "pan", "center", "중앙"],
        run: handleResetPan
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard shortcuts",
        detail: "키바인딩 도움말 열기",
        shortcut: "?",
        keywords: ["help", "shortcuts", "도움말"],
        run: () => setShowKeyboardHelp(true)
      }
    ],
    [
      focusSearchInput,
      focusSearchMatch,
      handleAddChildToSelectedNode,
      handleAddRootNode,
      handleAddSiblingAfterSelectedNode,
      handleCopySubtree,
      handleCutSubtree,
      handleDeleteSelectedNodes,
      handleEditSelectedNode,
      handleNormalizeMarkdown,
      handleOpen,
      handlePasteSubtree,
      handleRedo,
      handleResetPan,
      handleResetZoom,
      handleSave,
      handleSaveAs,
      handleToggleSelectedNodeCollapse,
      handleUndo,
      handleZoomIn,
      handleZoomOut,
      history,
      mindmap,
      searchMatches.length,
      selectedClipboardNodes.length,
      selectedClipboardPaths.length,
      selectedDocumentNode,
      viewState.selectedNodePath
    ]
  );

  const executeCommandPaletteCommand = useCallback(
    (command: CommandPaletteCommand) => {
      if (command.disabled) {
        return;
      }

      setShowCommandPalette(false);
      setCommandPaletteQuery("");
      void Promise.resolve(command.run()).catch((error) => {
        setNotice(`명령을 실행할 수 없습니다: ${errorMessage(error)}`);
      });
    },
    []
  );

  const handlePrepareDiff = useCallback(async () => {
    if (!activeDocument.file || !activeDocument.conflict) {
      return;
    }

    if (!nativeAvailable) {
      setNotice("diff 파일 생성은 Tauri 데스크톱 실행에서 사용할 수 있습니다.");
      return;
    }

    try {
      const result = await openExternalDiff(
        activeDocument.file.path,
        activeDocument.conflict.appSource,
        activeDocument.conflict.disk.contents
      );
      setDiffFiles(result.files);
      setNotice(result.message);
    } catch (error) {
      setNotice(`diff 파일을 만들 수 없습니다: ${errorMessage(error)}`);
    }
  }, [activeDocument.conflict, activeDocument.file, nativeAvailable]);

  const handleUseDiskVersion = useCallback(() => {
    const nextDocument = chooseDiskVersion(activeDocument);
    setHistory((current) =>
      commitHistory(current, nextDocument, "Reload disk version", documentsEqual)
    );
    const result = parseMindmap(nextDocument.source);
    setViewState(createDefaultViewState(result.ok ? firstNodePath(result.mindmap) : ""));
    setDiffFiles(null);
  }, [activeDocument]);

  const handleKeepAppVersion = useCallback(() => {
    replaceDocument(chooseAppVersion(activeDocument), "Keep app version");
    setDiffFiles(null);
  }, [activeDocument, replaceDocument]);

  const applyExternalFileSnapshot = useCallback((snapshot: FileSnapshot) => {
    setHistory((current) => {
      const currentDocument = current.present.value;
      if (
        currentDocument.file?.path !== snapshot.path ||
        currentDocument.saveStatus === "saving"
      ) {
        return current;
      }

      const result = applyExternalSnapshot(currentDocument, snapshot);
      if (result.kind === "unchanged") {
        return current;
      }

      if (result.kind === "reloaded") {
        const reloaded = parseMindmap(result.state.source);
        setViewState(
          createDefaultViewState(reloaded.ok ? firstNodePath(reloaded.mindmap) : "")
        );
        return commitHistory(
          current,
          result.state,
          "Reload external changes",
          documentsEqual
        );
      }

      return replacePresent(current, result.state, result.kind);
    });
  }, []);

  useEffect(() => {
    if (!nativeAvailable || !activeDocument.file) {
      return;
    }

    const timer = window.setTimeout(() => {
      void writeAppState(
        activeDocument.file!.path,
        viewStateKey,
        serializeViewState(viewState)
      ).catch(() => {
        // SQLite app state is intentionally best-effort.
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeDocument.file, nativeAvailable, viewState]);

  useEffect(() => {
    if (
      !nativeAvailable ||
      !activeDocument.file ||
      !activeDocument.dirty ||
      activeDocument.conflict ||
      activeDocument.saveStatus === "saving"
    ) {
      return;
    }

    const validation = parseMindmap(activeDocument.source);
    if (!validation.ok) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveCurrent(activeDocument.file!.path);
    }, autosaveDelayMs);

    return () => window.clearTimeout(timer);
  }, [
    activeDocument.conflict,
    activeDocument.dirty,
    activeDocument.file,
    activeDocument.saveStatus,
    activeDocument.source,
    nativeAvailable,
    saveCurrent
  ]);

  useEffect(() => {
    if (!nativeAvailable || !activeDocument.file) {
      return;
    }

    const path = activeDocument.file.path;
    const timer = window.setInterval(() => {
      void readMarkdownFile(path)
        .then(applyExternalFileSnapshot)
        .catch(() => {
          // Polling failure should not disturb the current editable document.
        });
    }, externalPollMs);

    return () => window.clearInterval(timer);
  }, [activeDocument.file, applyExternalFileSnapshot, nativeAvailable]);

  useEffect(() => {
    if (!nativeAvailable || !activeDocument.file) {
      return;
    }

    const path = activeDocument.file.path;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void watchMarkdownFile(path).catch(() => {
      // Polling remains the fallback when a native watcher cannot start.
    });

    void listenMarkdownFileChanged((event) => {
      if (disposed || event.path !== path) {
        return;
      }

      void readMarkdownFile(path)
        .then(applyExternalFileSnapshot)
        .catch(() => {
          // A transient watcher read failure should not disturb editing.
        });
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      void unwatchMarkdownFile(path).catch(() => {
        // The watcher is best-effort and polling remains available.
      });
    };
  }, [activeDocument.file, applyExternalFileSnapshot, nativeAvailable]);

  useEffect(() => {
    if (!mindmap) {
      return;
    }

    const fallbackPath = firstNodePath(mindmap);
    const validSelectedPaths = selectionPathsForMindmap(mindmap, viewState);
    const selectedPathIsValid =
      isRootNodePath(viewState.selectedNodePath) ||
      (viewState.selectedNodePath && findNode(mindmap, viewState.selectedNodePath));
    const nextSelectedPath = selectedPathIsValid
      ? viewState.selectedNodePath
      : validSelectedPaths[0] ?? fallbackPath;
    const nextCollapsedPaths = collapsedPathsForMindmap(
      mindmap,
      viewState.collapsedNodePaths
    );
    const nextEditingPath =
      viewState.editingNodePath &&
      (isRootNodePath(viewState.editingNodePath) ||
        findNode(mindmap, viewState.editingNodePath))
        ? viewState.editingNodePath
        : !viewState.selectedNodePath && nextSelectedPath
          ? nextSelectedPath
          : null;

    if (
      nextSelectedPath === viewState.selectedNodePath &&
      sameStringList(validSelectedPaths, viewState.selectedNodePaths) &&
      sameStringList(nextCollapsedPaths, viewState.collapsedNodePaths) &&
      nextEditingPath === viewState.editingNodePath
    ) {
      return;
    }

    setViewState((current) => ({
      ...current,
      selectedNodePath: nextSelectedPath,
      selectedNodePaths: validSelectedPaths.length > 0 ? validSelectedPaths : [nextSelectedPath],
      selectionAnchorPath: validSelectedPaths.includes(current.selectionAnchorPath ?? "")
        ? current.selectionAnchorPath
        : nextSelectedPath || null,
      editingNodePath:
        current.editingNodePath &&
        (isRootNodePath(current.editingNodePath) ||
          findNode(mindmap, current.editingNodePath))
          ? current.editingNodePath
          : !current.selectedNodePath && nextSelectedPath
            ? nextSelectedPath
            : null,
      collapsedNodePaths: nextCollapsedPaths
    }));
  }, [
    mindmap,
    viewState.collapsedNodePaths,
    viewState.editingNodePath,
    viewState.selectedNodePath,
    viewState.selectedNodePaths
  ]);

  useEffect(() => {
    if (!viewState.editingNodePath) {
      return;
    }

    const input = globalThis.document?.querySelector<HTMLElement>(
      `[data-node-path="${CSS.escape(viewState.editingNodePath)}"]`
    );
    input?.focus();
  }, [viewState.editingNodePath]);

  useLayoutEffect(() => {
    if (!mindmap) {
      setConnectorPaths([]);
      return;
    }

    const updateConnectors = () => {
      const workspace = workspaceRef.current;
      if (!workspace) {
        setConnectorPaths([]);
        return;
      }

      setConnectorPaths(
        buildConnectorPaths(workspace, mindmap, viewState.zoom, collapsedPathSet)
      );
    };

    updateConnectors();

    const frame = window.requestAnimationFrame(updateConnectors);
    const resizeObserver = new ResizeObserver(updateConnectors);
    resizeObserver.observe(workspaceRef.current!);
    workspaceRef.current!
      .querySelectorAll("[data-node-path]")
      .forEach((element) => resizeObserver.observe(element));
    window.addEventListener("resize", updateConnectors);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateConnectors);
    };
  }, [collapsedPathSet, mindmap, viewState.zoom]);

  useEffect(() => {
    if (!showKeyboardHelp) {
      return;
    }

    const closeButton = globalThis.document?.querySelector<HTMLButtonElement>(
      "[data-keyboard-help-close]"
    );
    closeButton?.focus();
  }, [showKeyboardHelp]);

  useEffect(() => {
    if (!showCommandPalette) {
      return;
    }

    commandPaletteInputRef.current?.focus();
  }, [showCommandPalette]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) {
        return;
      }

      const key = event.key.toLowerCase();
      const editing = viewState.editingNodePath !== null;
      if (showKeyboardHelp) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShowKeyboardHelp(false);
        }
        return;
      }

      if (showCommandPalette) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        openCommandPalette();
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "p") {
        event.preventDefault();
        openCommandPalette();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowKeyboardHelp(true);
      } else if (!editing && (event.key === "?" || (event.shiftKey && event.key === "/"))) {
        event.preventDefault();
        setShowKeyboardHelp(true);
      } else if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        focusSearchInput();
      } else if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        void handleSave();
      } else if ((event.metaKey || event.ctrlKey) && key === "o") {
        event.preventDefault();
        void handleOpen();
      } else if ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
      } else if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        handleUndo();
      } else if ((event.metaKey || event.ctrlKey) && key === "y") {
        event.preventDefault();
        handleRedo();
      } else if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        handleZoomIn();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        handleZoomOut();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        handleResetZoom();
      } else if (!editing && (event.metaKey || event.ctrlKey) && key === "c") {
        event.preventDefault();
        void handleCopySubtree();
      } else if (!editing && (event.metaKey || event.ctrlKey) && key === "x") {
        event.preventDefault();
        void handleCutSubtree();
      } else if (!editing && (event.metaKey || event.ctrlKey) && key === "v") {
        event.preventDefault();
        void handlePasteSubtree();
      } else if (!editing && mindmap && viewState.selectedNodePath) {
        const moveDirection = modifiedArrowDirectionForEvent(event);
        if (moveDirection) {
          event.preventDefault();
          moveSelectedNodes(moveDirection);
          return;
        }

        const spatialDirection = spatialDirectionForKey(event.key);
        if (spatialDirection) {
          event.preventDefault();
          const nextPath = spatialNodePath(
            workspaceRef.current,
            viewState.selectedNodePath,
            spatialDirection
          );
          if (event.shiftKey) {
            selectNodeRange(nextPath);
          } else {
            selectNodeAndFocus(nextPath, false);
          }
        } else if (
          event.key === "Tab" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          if (event.shiftKey) {
            selectNodeAndFocus(
              parentNodePath(mindmap, viewState.selectedNodePath),
              false
            );
            return;
          }

          if (isRootNodePath(viewState.selectedNodePath)) {
            const childPath = firstNodePath(mindmap);
            if (childPath) {
              selectNodeAndFocus(childPath, false);
            }
            return;
          }

          const childPath = firstChildPathForExistingNode(
            mindmap,
            viewState.selectedNodePath
          );
          if (childPath) {
            expandNode(viewState.selectedNodePath);
            selectNodeAndFocus(childPath, false);
            return;
          }

          const next = addChildNode(mindmap, viewState.selectedNodePath);
          commitMindmap(
            next,
            "Add child node",
            lastChildPath(next, viewState.selectedNodePath)
          );
        } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          handleAddSiblingAfterSelectedNode();
        } else if (event.key === "Enter") {
          event.preventDefault();
          selectNode(viewState.selectedNodePath, true);
        } else if (event.key === " ") {
          event.preventDefault();
          toggleCollapsedNode(viewState.selectedNodePath);
        } else if (event.key === "Backspace" || event.key === "Delete") {
          if (isRootNodePath(viewState.selectedNodePath)) {
            event.preventDefault();
            return;
          }

          event.preventDefault();
          handleDeleteSelectedNodes();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commitMindmap,
    closeCommandPalette,
    expandNode,
    focusSearchInput,
    handleAddSiblingAfterSelectedNode,
    handleCopySubtree,
    handleCutSubtree,
    handleDeleteSelectedNodes,
    handleOpen,
    handlePasteSubtree,
    handleRedo,
    handleResetZoom,
    handleSave,
    handleUndo,
    handleZoomIn,
    handleZoomOut,
    mindmap,
    moveFocusedNode,
    moveSelectedNodes,
    openCommandPalette,
    selectNode,
    selectNodeAndFocus,
    selectNodeRange,
    showCommandPalette,
    showKeyboardHelp,
    toggleCollapsedNode,
    viewState.editingNodePath,
    viewState.selectedNodePath
  ]);

  const rightNodes = mindmap?.children.filter((node) => node.direction === "right") ?? [];
  const leftNodes = mindmap?.children.filter((node) => node.direction === "left") ?? [];
  const workspaceStyle = {
    "--workspace-zoom": String(viewState.zoom),
    "--workspace-pan-x": `${viewState.pan.x}px`,
    "--workspace-pan-y": `${viewState.pan.y}px`
  } as CSSProperties;
  const rootEditing = viewState.editingNodePath === rootNodePath;
  const rootDropTarget =
    nodeDropTarget?.targetPath === rootNodePath ? nodeDropTarget : null;
  const renderNodeEditor = (node: MindmapNode, side: Direction) => (
    <NodeEditor
      key={node.path}
      node={node}
      side={side}
      selectedPath={viewState.selectedNodePath}
      selectedPaths={selectedNodePaths}
      editingPath={viewState.editingNodePath}
      searchMatchPaths={searchMatchPaths}
      currentSearchPath={currentSearchPath}
      collapsedPaths={collapsedPathSet}
      dragSourcePath={isNodeDragging ? nodeDragRef.current?.sourcePath ?? null : null}
      dropTarget={nodeDropTarget}
      onSelect={(path, editing) => selectNode(path, editing)}
      onSelectRange={selectNodeRange}
      onToggleSelect={toggleNodeSelection}
      onExitEditing={exitEditingIfCurrent}
      onTextChange={(path, text) => {
        commitMindmap(updateNodeText(mindmap!, path, text), "Edit node text", path);
      }}
      onAddChild={(path) => {
        const next = addChildNode(mindmap!, path);
        commitMindmap(next, "Add child node", lastChildPath(next, path));
      }}
      onAddSibling={(path) => {
        const next = addSiblingNode(mindmap!, path);
        commitMindmap(next, "Add sibling node", nextSiblingNodePath(next, path));
      }}
      onFocusChildOrCreate={(path) => {
        const childPath = firstChildPathForExistingNode(mindmap!, path);
        if (childPath) {
          expandNode(path);
          selectNode(childPath, true);
          return;
        }

        const next = addChildNode(mindmap!, path);
        commitMindmap(next, "Add child node", lastChildPath(next, path));
      }}
      onFocusNextOrCreate={(path) => {
        const nextPath = nextSiblingNodePath(mindmap!, path);
        if (nextPath !== path) {
          selectNode(nextPath, true);
          return;
        }

        const next = addSiblingNode(mindmap!, path);
        commitMindmap(next, "Add sibling node", nextSiblingNodePath(next, path));
      }}
      onDelete={(path) => {
        const fallback = previousNodePath(mindmap!, path);
        const next = deleteNode(mindmap!, path);
        commitMindmap(
          next,
          "Delete node",
          findNode(next, fallback) ? fallback : firstNodePath(next)
        );
      }}
      onDeleteEmpty={(path, nextFocusedNode) => {
        const preferredPath = nextFocusedNode
          ? remapPathAfterDeleting(path, nextFocusedNode.path)
          : null;
        const fallback = preferredPath ?? previousNodePath(mindmap!, path);
        const next = deleteNode(mindmap!, path);
        commitMindmap(
          next,
          "Delete empty node",
          selectionPathAfterDelete(next, fallback),
          preferredPath !== null && nextFocusedNode?.editing === true
        );
      }}
      onFocusPrevious={(path) => {
        const previousPath = previousSiblingNodePath(mindmap!, path);
        if (previousPath !== path) {
          selectNode(previousPath, true);
          return;
        }

        const next = addPreviousSiblingNode(mindmap!, path);
        commitMindmap(next, "Add previous sibling node", path);
      }}
      onFocusParent={(path) => {
        selectNode(parentNodePath(mindmap!, path), true);
      }}
      onMove={(path, direction) => {
        moveFocusedNode(path, direction, true);
      }}
      onToggleCollapse={(path) => toggleCollapsedNode(path)}
      onDragPointerDown={handleNodeDragPointerDown}
      onDragPointerMove={handleNodeDragPointerMove}
      onDragPointerUp={handleNodeDragPointerUp}
      onDragPointerCancel={handleNodeDragPointerCancel}
    />
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="file-name">{fileName}</div>
          <div className={`status ${status.kind}`}>{status.text}</div>
        </div>
        <div className="toolbar">
          <button type="button" onClick={handleOpen}>
            Open
          </button>
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <button type="button" onClick={handleSaveAs}>
            Save As
          </button>
          <button type="button" onClick={handleNormalizeMarkdown}>
            Normalize
          </button>
          <button type="button" onClick={handleUndo} disabled={!canUndo(history)}>
            Undo
          </button>
          <button type="button" onClick={handleRedo} disabled={!canRedo(history)}>
            Redo
          </button>
          <button
            type="button"
            onClick={handleCopySubtree}
            disabled={!mindmap || selectedClipboardNodes.length === 0}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handleCutSubtree}
            disabled={!mindmap || selectedClipboardNodes.length === 0}
          >
            Cut
          </button>
          <button
            type="button"
            onClick={handlePasteSubtree}
            disabled={!mindmap || !selectedDocumentNode}
          >
            Paste
          </button>
          <div className="search-controls" role="search" aria-label="Node search">
            <input
              ref={searchInputRef}
              type="search"
              className="search-input"
              aria-label="Search nodes"
              placeholder="Search"
              value={searchQuery}
              disabled={!mindmap}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchCursor(0);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  focusSearchMatch(event.shiftKey ? "previous" : "next");
                } else if (event.key === "Escape") {
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              aria-label="Previous search match"
              title="Previous search match"
              disabled={searchMatches.length === 0}
              onClick={() => focusSearchMatch("previous")}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next search match"
              title="Next search match"
              disabled={searchMatches.length === 0}
              onClick={() => focusSearchMatch("next")}
            >
              ↓
            </button>
            <output className="search-count" aria-label="Search result count">
              {searchStatusText}
            </output>
          </div>
          <button
            type="button"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setShowKeyboardHelp(true)}
          >
            ?
          </button>
          <button
            type="button"
            aria-label="Command palette"
            title="Command palette"
            onClick={openCommandPalette}
          >
            Cmd
          </button>
          {mindmap && (
            <>
              <button
                type="button"
                aria-label="Add right root node"
                title="Add right root node"
                onClick={() => handleAddRootNode("right")}
              >
                +R
              </button>
              <button
                type="button"
                aria-label="Add left root node"
                title="Add left root node"
                onClick={() => handleAddRootNode("left")}
              >
                +L
              </button>
            </>
          )}
          <div className="zoom-controls" aria-label="Zoom controls">
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={handleZoomOut}
            >
              -
            </button>
            <button
              type="button"
              aria-label="Reset zoom"
              title="Reset zoom"
              onClick={handleResetZoom}
            >
              {formatZoom(viewState.zoom)}
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={handleZoomIn}
            >
              +
            </button>
          </div>
          <div className="pan-controls" aria-label="Pan controls">
            <button
              type="button"
              className="pan-up"
              aria-label="Pan up"
              title="Pan up"
              onClick={() => handlePanNudge(0, -panNudgeStep)}
            >
              ↑
            </button>
            <button
              type="button"
              className="pan-left"
              aria-label="Pan left"
              title="Pan left"
              onClick={() => handlePanNudge(-panNudgeStep, 0)}
            >
              ←
            </button>
            <output className="pan-readout" aria-label="Pan offset">
              {formatPan(viewState.pan)}
            </output>
            <button
              type="button"
              className="pan-right"
              aria-label="Pan right"
              title="Pan right"
              onClick={() => handlePanNudge(panNudgeStep, 0)}
            >
              →
            </button>
            <button
              type="button"
              className="pan-down"
              aria-label="Pan down"
              title="Pan down"
              onClick={() => handlePanNudge(0, panNudgeStep)}
            >
              ↓
            </button>
            <button
              type="button"
              className="pan-reset"
              aria-label="Reset pan"
              title="Reset pan"
              onClick={handleResetPan}
            >
              Center
            </button>
          </div>
        </div>
      </header>

      {showKeyboardHelp && (
        <KeyboardHelpModal onClose={() => setShowKeyboardHelp(false)} />
      )}

      {showCommandPalette && (
        <CommandPaletteModal
          commands={commandPaletteCommands}
          query={commandPaletteQuery}
          inputRef={commandPaletteInputRef}
          onQueryChange={setCommandPaletteQuery}
          onRun={executeCommandPaletteCommand}
          onClose={closeCommandPalette}
        />
      )}

      {notice && (
        <section className="notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            OK
          </button>
        </section>
      )}

      {activeDocument.conflict && (
        <section className="conflict-panel">
          <div>
            <strong>external change conflict</strong>
            <span>디스크 파일이 바뀌었지만 현재 앱에도 저장되지 않은 변경이 있습니다.</span>
          </div>
          <div className="conflict-actions">
            <button type="button" onClick={handleUseDiskVersion}>
              Reload Disk
            </button>
            <button type="button" onClick={handleKeepAppVersion}>
              Keep App
            </button>
            <button type="button" onClick={handlePrepareDiff}>
              Open Diff
            </button>
          </div>
          {diffFiles && (
            <pre className="diff-files">{`${diffFiles.appPath}\n${diffFiles.diskPath}`}</pre>
          )}
        </section>
      )}

      {activeDocument.externalError && (
        <section className="conflict-panel">
          <div>
            <strong>external file parse error</strong>
            <span>디스크 파일이 바뀌었지만 mindmap parser가 읽을 수 없습니다.</span>
          </div>
          <Diagnostics diagnostics={activeDocument.externalError.diagnostics} compact />
        </section>
      )}

      {parseResult.ok ? (
        <>
          <section
            className={`workspace-viewport${isPanning ? " is-panning" : ""}${
              isNodeDragging ? " is-node-dragging" : ""
            }`}
            aria-label="Mindmap canvas"
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={stopViewportPan}
            onPointerCancel={stopViewportPan}
            onWheel={handleViewportWheel}
          >
            <section
              className={`workspace${leftNodes.length > 0 ? " has-left" : ""}${
                rightNodes.length > 0 ? " has-right" : ""
              }`}
              ref={workspaceRef}
              style={workspaceStyle}
            >
              <svg className="connector-layer" aria-hidden="true">
                {connectorPaths.map((connector) => (
                  <path key={connector.id} d={connector.d} />
                ))}
              </svg>
              <aside className="branch branch-left" aria-label="Left branch">
                {leftNodes.length > 0 && (
                  <div className="root-child-column">
                    {leftNodes.map((node) => renderNodeEditor(node, "left"))}
                  </div>
                )}
              </aside>

              <section className="root-node" aria-label="Root node">
                <NodeTextArea
                  className={classNames(
                    viewState.selectedNodePath === rootNodePath && "selected",
                    rootEditing && "editing",
                    searchMatchPaths.has(rootNodePath) && "search-match",
                    currentSearchPath === rootNodePath && "current-search-match",
                    rootDropTarget && `drop-${rootDropTarget.position}`,
                    rootDropTarget?.rootDirection && `drop-${rootDropTarget.rootDirection}`
                  )}
                  path={rootNodePath}
                  value={mindmap!.title}
                  width={getRootInputWidth(mindmap!.title)}
                  ariaLabel="Root heading"
                  readOnly={!rootEditing}
                  editOnClick={viewState.selectedNodePath === rootNodePath && !rootEditing}
                  onFocus={() => selectNode(rootNodePath, rootEditing)}
                  onEditClick={() => selectNode(rootNodePath, true)}
                  onToggleSelect={() => selectNode(rootNodePath, false)}
                  onRangeSelect={() => selectNode(rootNodePath, false)}
                  onChange={(text) =>
                    commitMindmap(updateRootTitle(mindmap!, text), "Edit root heading")
                  }
                  onBlur={() => exitEditingIfCurrent(rootNodePath)}
                  onDragPointerDown={undefined}
                  onDragPointerMove={undefined}
                  onDragPointerUp={undefined}
                  onDragPointerCancel={undefined}
                  onKeyDown={(event) => {
                    if (!rootEditing) {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        selectNode(rootNodePath, true);
                      }
                      return;
                    }

                    if (isImeComposing(event)) {
                      return;
                    }

                    if (event.key === "Enter" || (event.key === "Tab" && event.shiftKey)) {
                      event.preventDefault();
                      selectNode(rootNodePath, true);
                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      selectNode(rootNodePath, false);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </section>

              <aside className="branch branch-right" aria-label="Right branch">
                {rightNodes.length > 0 && (
                  <div className="root-child-column">
                    {rightNodes.map((node) => renderNodeEditor(node, "right"))}
                  </div>
                )}
              </aside>
            </section>
          </section>

          <section className="markdown-panel" aria-label="Markdown output">
            <pre>{activeDocument.source}</pre>
          </section>

          {nodeDragSnapLine && (
            <svg className="node-drag-snap-layer" aria-hidden="true">
              <path className="node-drag-snap-line" d={nodeDragSnapLine.d} />
              <circle
                className="node-drag-snap-dot"
                cx={nodeDragSnapLine.start.x}
                cy={nodeDragSnapLine.start.y}
                r="4"
              />
              <circle
                className="node-drag-snap-dot"
                cx={nodeDragSnapLine.end.x}
                cy={nodeDragSnapLine.end.y}
                r="4"
              />
            </svg>
          )}

          {nodeDragPreview && (
            <div
              className="node-drag-preview"
              aria-hidden="true"
              data-drag-preview-path={nodeDragPreview.sourcePath}
              style={{
                left: nodeDragPreview.x,
                top: nodeDragPreview.y,
                width: nodeDragPreview.width,
                minHeight: nodeDragPreview.minHeight
              }}
            >
              {nodeDragPreview.text || "\u00a0"}
            </div>
          )}
        </>
      ) : (
        <Diagnostics diagnostics={parseResult.diagnostics} />
      )}
    </main>
  );
}

function KeyboardHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section
        className="keyboard-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
      >
        <header>
          <div>
            <h2 id="keyboard-help-title">키바인딩</h2>
            <p>현재 구현된 키보드 조작</p>
          </div>
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            data-keyboard-help-close
            onClick={onClose}
          >
            x
          </button>
        </header>
        <div className="shortcut-groups">
          {keyboardShortcutGroups.map((group) => (
            <section className="shortcut-group" key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.shortcuts.map((shortcut) => (
                  <div className="shortcut-row" key={`${group.title}-${shortcut.keys}`}>
                    <dt>
                      {shortcut.keys.split(" 또는 ").map((key, index) => (
                        <span key={key}>
                          {index > 0 && <span className="shortcut-separator">또는</span>}
                          <kbd>{key}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{shortcut.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function CommandPaletteModal({
  commands,
  query,
  inputRef,
  onQueryChange,
  onRun,
  onClose
}: {
  commands: CommandPaletteCommand[];
  query: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onRun: (command: CommandPaletteCommand) => void;
  onClose: () => void;
}) {
  const visibleCommands = useMemo(
    () => filteredCommandPaletteCommands(commands, query),
    [commands, query]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeCommand = visibleCommands[activeIndex] ?? null;

  useEffect(() => {
    setActiveIndex(firstEnabledCommandIndex(visibleCommands));
  }, [query, visibleCommands]);

  const runActiveCommand = useCallback(() => {
    const command =
      activeCommand && !activeCommand.disabled
        ? activeCommand
        : visibleCommands.find((item) => !item.disabled);
    if (command) {
      onRun(command);
    }
  }, [activeCommand, onRun, visibleCommands]);

  return (
    <div
      className="modal-backdrop command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              nextEnabledCommandIndex(visibleCommands, current, 1)
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              nextEnabledCommandIndex(visibleCommands, current, -1)
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            runActiveCommand();
          }
        }}
      >
        <header>
          <div>
            <h2>커맨드 팔렛트</h2>
            <p>명령 이름이나 키워드로 실행할 작업을 찾습니다.</p>
          </div>
          <button type="button" aria-label="Close command palette" onClick={onClose}>
            x
          </button>
        </header>
        <input
          ref={inputRef}
          type="search"
          className="command-palette-input"
          aria-label="Command palette input"
          aria-activedescendant={activeCommand ? `command-${activeCommand.id}` : undefined}
          placeholder="Search commands"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="command-list" role="listbox" aria-label="Commands">
          {visibleCommands.length === 0 ? (
            <div className="command-empty">일치하는 명령이 없습니다.</div>
          ) : (
            visibleCommands.map((command, index) => (
              <button
                key={command.id}
                id={`command-${command.id}`}
                type="button"
                role="option"
                className={classNames(
                  "command-item",
                  index === activeIndex && "active"
                )}
                aria-selected={index === activeIndex}
                disabled={command.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onRun(command)}
              >
                <span className="command-copy">
                  <span className="command-title">{command.title}</span>
                  <span className="command-detail">{command.detail}</span>
                </span>
                {command.shortcut && (
                  <span className="command-shortcut">{command.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function NodeTextArea({
  className,
  path,
  value,
  width,
  ariaLabel,
  readOnly,
  editOnClick,
  onFocus,
  onEditClick,
  onToggleSelect,
  onRangeSelect,
  onChange,
  onBlur,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel,
  onKeyDown
}: {
  className: string;
  path: string;
  value: string;
  width: number;
  ariaLabel: string;
  readOnly: boolean;
  editOnClick: boolean;
  onFocus: () => void;
  onEditClick: () => void;
  onToggleSelect: () => void;
  onRangeSelect: () => void;
  onChange: (text: string) => void;
  onBlur: (nextFocusedNode: FocusedNodeTarget | null) => void;
  onDragPointerDown?: (event: PointerEvent<HTMLTextAreaElement>) => void;
  onDragPointerMove?: (event: PointerEvent<HTMLTextAreaElement>) => void;
  onDragPointerUp?: (event: PointerEvent<HTMLTextAreaElement>) => void;
  onDragPointerCancel?: (event: PointerEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOnClickRef = useRef(false);
  const pointerStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useLayoutEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }

    textArea.style.height = "auto";
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [value, width]);

  return (
    <textarea
      ref={textAreaRef}
      className={className}
      data-node-path={path}
      value={value}
      rows={1}
      wrap="soft"
      style={{ width }}
      aria-label={ariaLabel}
      readOnly={readOnly}
      onPointerDown={(event) => {
        if (readOnly && (event.metaKey || event.ctrlKey || event.shiftKey)) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          if (event.shiftKey) {
            onRangeSelect();
          } else {
            onToggleSelect();
          }
          return;
        }

        pointerStartRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY
        };
        suppressClickRef.current = false;
        onDragPointerDown?.(event);
      }}
      onPointerMove={(event) => {
        const pointerStart = pointerStartRef.current;
        if (pointerStart?.pointerId === event.pointerId) {
          const deltaX = event.clientX - pointerStart.x;
          const deltaY = event.clientY - pointerStart.y;
          if (Math.hypot(deltaX, deltaY) > clickMoveTolerancePx) {
            suppressClickRef.current = true;
          }
        }

        onDragPointerMove?.(event);
      }}
      onPointerUp={(event) => {
        onDragPointerUp?.(event);
        pointerStartRef.current = null;
      }}
      onPointerCancel={(event) => {
        onDragPointerCancel?.(event);
        pointerStartRef.current = null;
        suppressClickRef.current = true;
      }}
      onMouseDown={() => {
        editOnClickRef.current = editOnClick;
      }}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          editOnClickRef.current = false;
          return;
        }

        if (editOnClickRef.current) {
          onEditClick();
        }
        editOnClickRef.current = false;
      }}
      onFocus={onFocus}
      onChange={(event) => onChange(toSingleLineNodeText(event.target.value))}
      onBlur={(event) => onBlur(nodeTargetFromRelatedTarget(event))}
      onKeyDown={onKeyDown}
    />
  );
}

function preventActionPointerDown(event: PointerEvent<HTMLButtonElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

function NodeEditor({
  node,
  side,
  selectedPath,
  selectedPaths,
  editingPath,
  searchMatchPaths,
  currentSearchPath,
  collapsedPaths,
  dragSourcePath,
  dropTarget,
  onSelect,
  onSelectRange,
  onToggleSelect,
  onExitEditing,
  onTextChange,
  onAddChild,
  onAddSibling,
  onFocusChildOrCreate,
  onFocusNextOrCreate,
  onDelete,
  onDeleteEmpty,
  onFocusPrevious,
  onFocusParent,
  onMove,
  onToggleCollapse,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel
}: {
  node: MindmapNode;
  side: Direction;
  selectedPath: string;
  selectedPaths: string[];
  editingPath: string | null;
  searchMatchPaths: Set<string>;
  currentSearchPath: string | null;
  collapsedPaths: Set<string>;
  dragSourcePath: string | null;
  dropTarget: NodeDropTarget | null;
  onSelect: (path: string, editing: boolean) => void;
  onSelectRange: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onExitEditing: (path: string) => void;
  onTextChange: (path: string, text: string) => void;
  onAddChild: (path: string) => void;
  onAddSibling: (path: string) => void;
  onFocusChildOrCreate: (path: string) => void;
  onFocusNextOrCreate: (path: string) => void;
  onDelete: (path: string) => void;
  onDeleteEmpty: (path: string, nextFocusedNode?: FocusedNodeTarget | null) => void;
  onFocusPrevious: (path: string) => void;
  onFocusParent: (path: string) => void;
  onMove: (path: string, direction: NodeMoveDirection) => void;
  onToggleCollapse: (path: string) => void;
  onDragPointerDown: (
    path: string,
    event: PointerEvent<HTMLTextAreaElement>
  ) => void;
  onDragPointerMove: (
    path: string,
    event: PointerEvent<HTMLTextAreaElement>
  ) => void;
  onDragPointerUp: (path: string, event: PointerEvent<HTMLTextAreaElement>) => void;
  onDragPointerCancel: (
    path: string,
    event: PointerEvent<HTMLTextAreaElement>
  ) => void;
}) {
  const children =
    node.children.length > 0 ? (
      <div className="child-column">
        {node.children.map((child) => (
          <NodeEditor
            key={child.path}
            node={child}
            side={side}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            editingPath={editingPath}
            searchMatchPaths={searchMatchPaths}
            currentSearchPath={currentSearchPath}
            collapsedPaths={collapsedPaths}
            dragSourcePath={dragSourcePath}
            dropTarget={dropTarget}
            onSelect={onSelect}
            onSelectRange={onSelectRange}
            onToggleSelect={onToggleSelect}
            onExitEditing={onExitEditing}
            onTextChange={onTextChange}
            onAddChild={onAddChild}
            onAddSibling={onAddSibling}
            onFocusChildOrCreate={onFocusChildOrCreate}
            onFocusNextOrCreate={onFocusNextOrCreate}
            onDelete={onDelete}
            onDeleteEmpty={onDeleteEmpty}
            onFocusPrevious={onFocusPrevious}
            onFocusParent={onFocusParent}
            onMove={onMove}
            onToggleCollapse={onToggleCollapse}
            onDragPointerDown={onDragPointerDown}
            onDragPointerMove={onDragPointerMove}
            onDragPointerUp={onDragPointerUp}
            onDragPointerCancel={onDragPointerCancel}
          />
        ))}
      </div>
    ) : null;

  const selected = selectedPaths.includes(node.path);
  const primarySelected = selectedPath === node.path;
  const editing = editingPath === node.path;
  const collapsed = collapsedPaths.has(node.path);
  const hasChildren = node.children.length > 0;
  const actionTabIndex = selected || editing ? 0 : -1;

  return (
    <div className={`node-subtree ${side}${collapsed ? " collapsed" : ""}`}>
      {side === "left" && !collapsed && children}
      <div className="node-row">
        <NodeTextArea
          className={classNames(
            "node-input",
            selected && "selected",
            selected && !primarySelected && "secondary-selected",
            editing && "editing",
            node.text.length === 0 && node.children.length === 0 && "transient-empty",
            searchMatchPaths.has(node.path) && "search-match",
            currentSearchPath === node.path && "current-search-match",
            !editing && "draggable-node",
            dragSourcePath === node.path && "drag-source",
            dropTarget?.targetPath === node.path && `drop-${dropTarget.position}`
          )}
          path={node.path}
          value={node.text}
          width={getNodeInputWidth(node.text)}
          ariaLabel={`Node ${node.path}`}
          readOnly={!editing}
          editOnClick={primarySelected && !editing}
          onFocus={() => onSelect(node.path, editing)}
          onEditClick={() => onSelect(node.path, true)}
          onToggleSelect={() => onToggleSelect(node.path)}
          onRangeSelect={() => onSelectRange(node.path)}
          onChange={(text) => onTextChange(node.path, text)}
          onBlur={(nextFocusedPath) => {
            if (node.text.length === 0 && node.children.length === 0) {
              onDeleteEmpty(node.path, nextFocusedPath);
            } else if (nextFocusedPath?.editing) {
              return;
            } else {
              onExitEditing(node.path);
            }
          }}
          onDragPointerDown={(event) => onDragPointerDown(node.path, event)}
          onDragPointerMove={(event) => onDragPointerMove(node.path, event)}
          onDragPointerUp={(event) => onDragPointerUp(node.path, event)}
          onDragPointerCancel={(event) => onDragPointerCancel(node.path, event)}
          onKeyDown={(event) => {
            if (!editing) {
              return;
            }

            const shortcut = getNodeEditingShortcut(event);
            if (!shortcut) {
              return;
            }

            event.preventDefault();

            if (shortcut === "add-sibling") {
              onFocusNextOrCreate(node.path);
            } else if (shortcut === "add-sibling-below") {
              onAddSibling(node.path);
            } else if (shortcut === "add-child") {
              onFocusChildOrCreate(node.path);
            } else if (shortcut === "exit-editing") {
              event.currentTarget.blur();
            } else if (shortcut === "focus-previous") {
              onFocusPrevious(node.path);
            } else if (shortcut === "focus-parent") {
              onFocusParent(node.path);
            } else if (shortcut === "move-up") {
              onMove(node.path, "up");
            } else if (shortcut === "move-down") {
              onMove(node.path, "down");
            } else if (shortcut === "move-left") {
              onMove(node.path, "left");
            } else if (shortcut === "move-right") {
              onMove(node.path, "right");
            } else if (shortcut === "delete") {
              onDelete(node.path);
            }
          }}
        />
        {hasChildren && (
          <button
            type="button"
            className="node-toggle"
            aria-label={`${collapsed ? "Expand" : "Collapse"} Node ${node.path}`}
            title={collapsed ? "Expand" : "Collapse"}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={() => onToggleCollapse(node.path)}
          >
            {collapsed ? "›" : "⌄"}
          </button>
        )}
        <div className="node-actions" aria-label={`Node ${node.path} actions`}>
          <button
            type="button"
            className="node-action"
            aria-label={`Add child to Node ${node.path}`}
            title="Add child"
            tabIndex={actionTabIndex}
            onPointerDown={preventActionPointerDown}
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(node.path);
            }}
          >
            +
          </button>
          <button
            type="button"
            className="node-action"
            aria-label={`Add sibling after Node ${node.path}`}
            title="Add sibling"
            tabIndex={actionTabIndex}
            onPointerDown={preventActionPointerDown}
            onClick={(event) => {
              event.stopPropagation();
              onAddSibling(node.path);
            }}
          >
            ↵
          </button>
          <button
            type="button"
            className="node-action danger"
            aria-label={`Delete Node ${node.path}`}
            title="Delete"
            tabIndex={actionTabIndex}
            onPointerDown={preventActionPointerDown}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(node.path);
            }}
          >
            ×
          </button>
        </div>
      </div>
      {side === "right" && !collapsed && children}
    </div>
  );
}

function toSingleLineNodeText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ");
}

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function filteredCommandPaletteCommands(
  commands: CommandPaletteCommand[],
  query: string
): CommandPaletteCommand[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return commands;
  }

  return commands.filter((command) => {
    const haystack = [
      command.title,
      command.detail,
      command.shortcut ?? "",
      ...(command.keywords ?? [])
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function firstEnabledCommandIndex(commands: CommandPaletteCommand[]): number {
  const index = commands.findIndex((command) => !command.disabled);
  return index === -1 ? 0 : index;
}

function nextEnabledCommandIndex(
  commands: CommandPaletteCommand[],
  currentIndex: number,
  direction: 1 | -1
): number {
  if (commands.length === 0) {
    return 0;
  }

  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index =
      (currentIndex + direction * offset + commands.length) % commands.length;
    if (!commands[index].disabled) {
      return index;
    }
  }

  return Math.min(currentIndex, commands.length - 1);
}

function nodeTargetFromRelatedTarget(
  event: ReactFocusEvent<HTMLElement>
): FocusedNodeTarget | null {
  const target = event.relatedTarget;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const element = target.closest<HTMLElement>("[data-node-path]");
  const path = element?.dataset.nodePath;
  if (!path) {
    return null;
  }

  return {
    path,
    editing: target instanceof HTMLTextAreaElement && !target.readOnly
  };
}

function formatParseFailureNotice(
  title: string,
  diagnostics: Diagnostic[],
  source?: string
): string {
  const diagnostic = diagnostics[0];
  const lines = [
    title,
    "",
    `${diagnostic.code}: ${diagnosticSummary(diagnostic)}`,
    `위치: ${diagnostic.line}행 ${diagnostic.column}열`
  ];
  const sourceLine = sourceLineForDiagnostic(source, diagnostic.line);
  if (sourceLine !== null) {
    lines.push(`문제 줄: ${showWhitespace(sourceLine)}`);
  }

  const detail = diagnosticDetail(diagnostic);
  lines.push("", `원인: ${detail.reason}`);
  if (detail.note) {
    lines.push(`참고: ${detail.note}`);
  }

  lines.push("", "예시:", `잘못된 예: ${detail.badExample}`, `올바른 예: ${detail.goodExample}`);

  if (diagnostic.help && diagnostic.code !== "MM018") {
    lines.push("", `도움말: ${diagnostic.help}`);
  }

  return lines.join("\n");
}

function diagnosticSummary(diagnostic: Diagnostic): string {
  if (diagnostic.code === "MM018") {
    return "Markdown 줄 끝 또는 파일 끝 형식이 canonical 포맷과 맞지 않습니다.";
  }

  return diagnostic.message;
}

function diagnosticDetail(diagnostic: Diagnostic): {
  reason: string;
  badExample: string;
  goodExample: string;
  note?: string;
} {
  if (diagnostic.code !== "MM018") {
    return {
      reason: diagnostic.message,
      badExample: "지원하지 않는 Markdown 구조",
      goodExample: "# 제목\\n\\n- 노드"
    };
  }

  if (diagnostic.message.includes("CRLF")) {
    return {
      reason: "파일 줄바꿈이 Windows식 CRLF입니다. 이 앱의 Markdown 포맷은 LF 줄바꿈만 허용합니다.",
      badExample: "각 줄 끝이 CRLF",
      goodExample: "각 줄 끝이 LF"
    };
  }

  if (diagnostic.message.includes("exactly one trailing newline")) {
    return {
      reason: "파일 마지막에는 개행이 정확히 1개 있어야 합니다.",
      badExample: "# 제목\\n\\n- 노드",
      goodExample: "# 제목\\n\\n- 노드\\n"
    };
  }

  if (diagnostic.message.includes("extra blank lines")) {
    return {
      reason: "파일 끝에 빈 줄이 2개 이상 붙어 있습니다.",
      badExample: "# 제목\\n\\n- 노드\\n\\n",
      goodExample: "# 제목\\n\\n- 노드\\n"
    };
  }

  if (diagnostic.message.includes("Empty list items")) {
    return {
      reason: "빈 노드는 marker 뒤 공백 없이 '-'만 써야 합니다.",
      badExample: "- ",
      goodExample: "-",
      note: "텍스트가 있는 노드의 끝 공백은 노드 텍스트로 보존되지만, 완전히 빈 노드는 '-' 형식만 허용합니다."
    };
  }

  return {
    reason: "제목, 방향 섹션, 빈 줄 같은 구조 줄 끝에 공백이나 탭이 있습니다.",
    badExample: "# 제목␠",
    goodExample: "# 제목",
    note: "단어 사이 공백은 괜찮지만 제목 맨 끝 공백은 Markdown heading 줄 끝 공백이 되어 허용하지 않습니다."
  };
}

function sourceLineForDiagnostic(source: string | undefined, line: number): string | null {
  if (!source || line < 1) {
    return null;
  }

  return source.split("\n")[line - 1] ?? null;
}

function showWhitespace(line: string): string {
  if (line.length === 0) {
    return "빈 줄";
  }

  return line
    .replace(/\t/g, "⇥")
    .replace(/\r/g, "␍")
    .replace(/ /g, "␠");
}

function Diagnostics({
  diagnostics,
  compact = false
}: {
  diagnostics: { code: string; message: string; line: number; column: number; help?: string }[];
  compact?: boolean;
}) {
  return (
    <section className={`diagnostics${compact ? " compact" : ""}`}>
      {diagnostics.map((diagnostic) => (
        <div className="diagnostic" key={`${diagnostic.code}-${diagnostic.line}`}>
          <strong>{diagnostic.code}</strong>
          <span>{diagnostic.message}</span>
          <small>
            line {diagnostic.line}, column {diagnostic.column}
          </small>
          {diagnostic.help && <em>{diagnostic.help}</em>}
        </div>
      ))}
    </section>
  );
}

function documentsEqual(left: DocumentState, right: DocumentState): boolean {
  return (
    left.source === right.source &&
    left.file?.path === right.file?.path &&
    left.file?.hash === right.file?.hash &&
    left.dirty === right.dirty &&
    left.saveStatus === right.saveStatus &&
    left.conflict?.disk.hash === right.conflict?.disk.hash &&
    left.externalError?.disk.hash === right.externalError?.disk.hash
  );
}

function statusLabel(
  activeDocument: DocumentState,
  nativeAvailable: boolean
): { kind: string; text: string } {
  if (activeDocument.conflict) {
    return { kind: "error", text: "conflict" };
  }

  if (activeDocument.externalError) {
    return { kind: "error", text: "external parse error" };
  }

  if (activeDocument.saveStatus === "saving") {
    return { kind: "pending", text: "saving" };
  }

  if (activeDocument.saveStatus === "error") {
    return { kind: "error", text: "save error" };
  }

  if (!nativeAvailable) {
    return { kind: "pending", text: "browser preview" };
  }

  if (activeDocument.dirty) {
    return { kind: "dirty", text: "unsaved" };
  }

  return { kind: "clean", text: "clean" };
}

function markSaveFinishedWithNewerEdits(
  documentState: DocumentState,
  snapshot: FileSnapshot,
  savedSource: string
): DocumentState {
  return {
    ...documentState,
    savedSource,
    file: {
      path: snapshot.path,
      name: snapshot.name,
      hash: snapshot.hash,
      mtimeMs: snapshot.mtimeMs,
      size: snapshot.size
    },
    dirty: documentState.source !== savedSource,
    saveStatus: documentState.source === savedSource ? "idle" : "pending",
    saveError: null
  };
}

function normalizeUndoAgainstDisk(
  before: HistoryState<DocumentState>,
  after: HistoryState<DocumentState>
): HistoryState<DocumentState> {
  if (before === after) {
    return after;
  }

  const beforeDocument = before.present.value;
  const afterDocument = after.present.value;
  const undoingExternalReload =
    beforeDocument.file &&
    afterDocument.file &&
    beforeDocument.file.path === afterDocument.file.path &&
    beforeDocument.file.hash !== afterDocument.file.hash &&
    beforeDocument.source === beforeDocument.savedSource;

  if (!undoingExternalReload) {
    return after;
  }

  return replacePresent(
    after,
    {
      ...afterDocument,
      file: beforeDocument.file,
      savedSource: beforeDocument.savedSource,
      dirty: afterDocument.source !== beforeDocument.savedSource,
      saveStatus:
        afterDocument.source === beforeDocument.savedSource ? "idle" : "pending"
    },
    `Undo ${before.present.label}`
  );
}

function lastRootPath(mindmap: Mindmap, direction: Direction): string {
  const roots = mindmap.children.filter((node) => node.direction === direction);
  return roots[roots.length - 1]?.path ?? "";
}

function lastChildPath(mindmap: Mindmap, parentPath: string): string {
  const parent = findNode(mindmap, parentPath);
  return parent?.children[parent.children.length - 1]?.path ?? parentPath;
}

function firstChildPathForExistingNode(
  mindmap: Mindmap,
  parentPath: string
): string | null {
  const parent = findNode(mindmap, parentPath);
  return parent?.children[0]?.path ?? null;
}

function selectionPathsForMindmap(
  mindmap: Mindmap | null,
  viewState: MindmapViewState
): string[] {
  if (!mindmap) {
    return viewState.selectedNodePaths;
  }

  const candidates =
    viewState.selectedNodePaths.length > 0
      ? viewState.selectedNodePaths
      : viewState.selectedNodePath
        ? [viewState.selectedNodePath]
        : [];
  const valid = candidates.filter(
    (path) => isRootNodePath(path) || findNode(mindmap, path)
  );
  if (
    viewState.selectedNodePath &&
    !valid.includes(viewState.selectedNodePath) &&
    (isRootNodePath(viewState.selectedNodePath) ||
      findNode(mindmap, viewState.selectedNodePath))
  ) {
    valid.push(viewState.selectedNodePath);
  }

  return orderSelectionPaths(mindmap, uniqueStrings(valid));
}

function collapsedPathsForMindmap(mindmap: Mindmap | null, paths: string[]): string[] {
  if (!mindmap) {
    return paths;
  }

  return orderSelectionPaths(
    mindmap,
    paths.filter((path) => {
      const node = findNode(mindmap, path);
      return node !== null && node.children.length > 0;
    })
  );
}

function searchNodePaths(mindmap: Mindmap, query: string): SearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const matches: SearchMatch[] = [];
  if (mindmap.title.toLocaleLowerCase().includes(normalizedQuery)) {
    matches.push({ path: rootNodePath });
  }

  for (const node of flattenNodes(mindmap)) {
    if (node.text.toLocaleLowerCase().includes(normalizedQuery)) {
      matches.push({ path: node.path });
    }
  }

  return matches;
}

function isDescendantPath(path: string, ancestorPath: string): boolean {
  return path.startsWith(`${ancestorPath}/`);
}

function focusNodeElementOnNextFrame(path: string): void {
  window.requestAnimationFrame(() => {
    const element = globalThis.document?.querySelector<HTMLElement>(
      `[data-node-path="${CSS.escape(path)}"]`
    );
    element?.focus();
  });
}

function orderSelectionPaths(mindmap: Mindmap, paths: string[]): string[] {
  const requested = new Set(paths);
  const ordered = flattenNodes(mindmap)
    .map((node) => node.path)
    .filter((path) => requested.has(path));

  if (requested.has(rootNodePath)) {
    return [rootNodePath, ...ordered];
  }

  return ordered;
}

function rangeSelectionPaths(
  mindmap: Mindmap,
  collapsedPaths: Set<string>,
  fromPath: string,
  toPath: string
): string[] {
  if (isRootNodePath(fromPath) || isRootNodePath(toPath)) {
    return [toPath];
  }

  const visiblePaths = visibleNodePaths(mindmap, collapsedPaths);
  const fromIndex = visiblePaths.indexOf(fromPath);
  const toIndex = visiblePaths.indexOf(toPath);
  if (fromIndex === -1 || toIndex === -1) {
    return [toPath];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return visiblePaths.slice(start, end + 1);
}

function visibleNodePaths(mindmap: Mindmap, collapsedPaths: Set<string>): string[] {
  const paths: string[] = [];
  for (const node of mindmap.children) {
    collectVisibleNodePaths(node, collapsedPaths, paths);
  }
  return paths;
}

function collectVisibleNodePaths(
  node: MindmapNode,
  collapsedPaths: Set<string>,
  paths: string[]
): void {
  paths.push(node.path);
  if (collapsedPaths.has(node.path)) {
    return;
  }

  for (const child of node.children) {
    collectVisibleNodePaths(child, collapsedPaths, paths);
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function selectionPathAfterDelete(mindmap: Mindmap, fallbackPath: string): string {
  if (isRootNodePath(fallbackPath)) {
    return firstNodePath(mindmap) || rootNodePath;
  }

  return findNode(mindmap, fallbackPath) ? fallbackPath : firstNodePath(mindmap);
}

function remapPathAfterDeleting(
  deletedPath: string,
  preferredPath: string
): string | null {
  if (
    preferredPath === deletedPath ||
    preferredPath.startsWith(`${deletedPath}/`) ||
    isRootNodePath(deletedPath)
  ) {
    return null;
  }

  if (isRootNodePath(preferredPath)) {
    return rootNodePath;
  }

  const deletedParts = deletedPath.split("/");
  const preferredParts = preferredPath.split("/");
  if (
    preferredParts.length < deletedParts.length ||
    deletedParts.length < 2 ||
    preferredParts[0] !== deletedParts[0]
  ) {
    return preferredPath;
  }

  const deletedSiblingIndexPosition = deletedParts.length - 1;
  const deletedParentParts = deletedParts.slice(0, deletedSiblingIndexPosition);
  const preferredParentPrefix = preferredParts.slice(0, deletedSiblingIndexPosition);
  if (!samePathParts(deletedParentParts, preferredParentPrefix)) {
    return preferredPath;
  }

  const deletedIndex = Number(deletedParts[deletedSiblingIndexPosition]);
  const preferredIndex = Number(preferredParts[deletedSiblingIndexPosition]);
  if (
    !Number.isInteger(deletedIndex) ||
    !Number.isInteger(preferredIndex) ||
    preferredIndex <= deletedIndex
  ) {
    return preferredPath;
  }

  const remappedParts = [...preferredParts];
  remappedParts[deletedSiblingIndexPosition] = String(preferredIndex - 1);
  return remappedParts.join("/");
}

function samePathParts(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function spatialDirectionForKey(key: string): SpatialDirection | null {
  if (key === "ArrowUp") {
    return "up";
  }

  if (key === "ArrowDown") {
    return "down";
  }

  if (key === "ArrowLeft") {
    return "left";
  }

  if (key === "ArrowRight") {
    return "right";
  }

  return null;
}

function modifiedArrowDirectionForEvent(event: KeyboardEvent): NodeMoveDirection | null {
  if (!event.metaKey && !event.ctrlKey) {
    return null;
  }

  return spatialDirectionForKey(event.key);
}

function nodeDropTargetFromPointer(
  workspace: HTMLElement | null,
  sourcePath: string,
  clientX: number,
  clientY: number
): NodeDropTarget | null {
  if (!workspace || !globalThis.document) {
    return null;
  }

  const seenPaths = new Set<string>();
  for (const element of globalThis.document.elementsFromPoint(clientX, clientY)) {
    const directTarget = nodeDropTargetForElement(
      workspace,
      sourcePath,
      element.closest<HTMLElement>("[data-node-path]"),
      clientX,
      clientY
    );
    if (!directTarget || seenPaths.has(directTarget.targetPath)) {
      continue;
    }

    seenPaths.add(directTarget.targetPath);
    return directTarget;
  }

  return nearestNodeDropTarget(workspace, sourcePath, clientX, clientY);
}

function nearestNodeDropTarget(
  workspace: HTMLElement,
  sourcePath: string,
  clientX: number,
  clientY: number
): NodeDropTarget | null {
  let bestTarget: { target: NodeDropTarget; score: number } | null = null;

  for (const element of workspace.querySelectorAll<HTMLElement>("[data-node-path]")) {
    const target = nodeDropTargetForElement(
      workspace,
      sourcePath,
      element,
      clientX,
      clientY
    );
    if (!target) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const distance = distanceToRect(rect, clientX, clientY);
    if (distance > nodeDropSnapDistancePx) {
      continue;
    }

    const verticalBias = Math.abs(clientY - (rect.top + rect.height / 2)) * 0.12;
    const score = distance + verticalBias;
    if (!bestTarget || score < bestTarget.score) {
      bestTarget = { target, score };
    }
  }

  return bestTarget?.target ?? null;
}

function nodeDropTargetForElement(
  workspace: HTMLElement,
  sourcePath: string,
  element: HTMLElement | null,
  clientX: number,
  clientY: number
): NodeDropTarget | null {
  const targetPath = element?.dataset.nodePath;
  if (
    !element ||
    !targetPath ||
    targetPath === sourcePath ||
    targetPath.startsWith(`${sourcePath}/`) ||
    !workspace.contains(element)
  ) {
    return null;
  }

  if (isRootNodePath(targetPath)) {
    const rect = element.getBoundingClientRect();
    return {
      sourcePath,
      targetPath,
      position: "inside",
      rootDirection: clientX < rect.left + rect.width / 2 ? "left" : "right"
    };
  }

  return {
    sourcePath,
    targetPath,
    position: nodeDropPosition(element.getBoundingClientRect(), clientY)
  };
}

function distanceToRect(rect: DOMRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

function nodeDropPosition(rect: DOMRect, clientY: number): NodeMovePosition {
  const localY = clientY - rect.top;
  const beforeLimit = rect.height * 0.3;
  const afterLimit = rect.height * 0.7;

  if (localY < beforeLimit) {
    return "before";
  }

  if (localY > afterLimit) {
    return "after";
  }

  return "inside";
}

function createNodeDragSnapLine(
  workspace: HTMLElement | null,
  target: NodeDropTarget,
  preview: NodeDragPreview
): NodeDragSnapLine | null {
  if (!workspace) {
    return null;
  }

  const targetElement = nodeElement(workspace, target.targetPath);
  if (!targetElement) {
    return null;
  }

  const targetRect = targetElement.getBoundingClientRect();
  const previewRect = {
    left: preview.x,
    right: preview.x + preview.width,
    top: preview.y,
    bottom: preview.y + preview.minHeight,
    centerX: preview.x + preview.width / 2,
    centerY: preview.y + preview.minHeight / 2
  };

  if (target.position === "inside") {
    const direction = target.rootDirection ?? nodeSide(target.targetPath) ?? "right";
    const start =
      direction === "right"
        ? { x: targetRect.right, y: targetRect.top + targetRect.height / 2 }
        : { x: targetRect.left, y: targetRect.top + targetRect.height / 2 };
    const end =
      direction === "right"
        ? { x: previewRect.left, y: previewRect.centerY }
        : { x: previewRect.right, y: previewRect.centerY };
    return { d: fixedCurvePath(start, end, direction), start, end };
  }

  const startY = target.position === "before" ? targetRect.top : targetRect.bottom;
  const start = { x: targetRect.left + targetRect.width / 2, y: startY };
  const end = { x: previewRect.centerX, y: previewRect.centerY };
  return {
    d: fixedCurvePath(start, end, start.x <= end.x ? "right" : "left"),
    start,
    end
  };
}

function fixedCurvePath(
  start: Point,
  end: Point,
  direction: Direction
): string {
  const distance = Math.max(Math.abs(end.x - start.x), 36);
  const handle = Math.min(120, Math.max(28, distance * 0.45));
  const startControlX = start.x + (direction === "right" ? handle : -handle);
  const endControlX = end.x + (direction === "right" ? -handle : handle);

  return [
    `M ${roundPathNumber(start.x)} ${roundPathNumber(start.y)}`,
    `C ${roundPathNumber(startControlX)} ${roundPathNumber(start.y)}`,
    `${roundPathNumber(endControlX)} ${roundPathNumber(end.y)}`,
    `${roundPathNumber(end.x)} ${roundPathNumber(end.y)}`
  ].join(" ");
}

function spatialNodePath(
  workspace: HTMLElement | null,
  currentPath: string,
  direction: SpatialDirection
): string {
  if (!workspace) {
    return currentPath;
  }

  if (direction === "left" || direction === "right") {
    return horizontalGenerationNodePath(workspace, currentPath, direction);
  }

  const currentElement = nodeElement(workspace, currentPath);
  if (!currentElement) {
    return currentPath;
  }

  const currentRect = currentElement.getBoundingClientRect();
  const currentAnchor = navigationAnchor(currentPath, currentRect);
  let bestCandidate: { path: string; score: number } | null = null;

  const nodeElements = Array.from(
    workspace.querySelectorAll<HTMLElement>("[data-node-path]")
  );
  for (const candidate of nodeElements) {
    const candidatePath = candidate.dataset.nodePath;
    if (!candidatePath || candidatePath === currentPath) {
      continue;
    }

    const candidateRect = candidate.getBoundingClientRect();
    const candidateAnchor = navigationAnchor(candidatePath, candidateRect);
    const primaryDistance = directionalDistance(
      currentAnchor,
      candidateAnchor,
      direction
    );
    if (primaryDistance <= 1) {
      continue;
    }

    const secondaryDistance = perpendicularDistance(
      currentAnchor,
      candidateAnchor,
      direction
    );
    const staysInLane = secondaryDistance <= 8;
    const score =
      primaryDistance +
      secondaryDistance * (staysInLane ? 2 : 8) +
      (staysInLane ? 0 : 1000);

    if (!bestCandidate || score < bestCandidate.score) {
      bestCandidate = { path: candidatePath, score };
    }
  }

  return bestCandidate?.path ?? currentPath;
}

function horizontalGenerationNodePath(
  workspace: HTMLElement,
  currentPath: string,
  direction: "left" | "right"
): string {
  const currentElement = nodeElement(workspace, currentPath);
  if (!currentElement) {
    return currentPath;
  }

  const currentSide = nodeSide(currentPath);
  if (!currentSide) {
    return bestHorizontalCandidate(
      workspace,
      currentPath,
      direction,
      nodeElementsForPaths(workspace, (path) => isRootLevelPath(path, direction))
    );
  }

  if (direction !== currentSide) {
    const parentPath = parentPathFromNodePath(currentPath);
    return nodeElement(workspace, parentPath) ? parentPath : currentPath;
  }

  return bestHorizontalCandidate(
    workspace,
    currentPath,
    direction,
    nodeElementsForPaths(workspace, (path) => isImmediateChildPath(path, currentPath))
  );
}

function bestHorizontalCandidate(
  workspace: HTMLElement,
  currentPath: string,
  direction: "left" | "right",
  candidates: HTMLElement[]
): string {
  const currentElement = nodeElement(workspace, currentPath);
  if (!currentElement) {
    return currentPath;
  }

  const currentAnchor = navigationAnchor(
    currentPath,
    currentElement.getBoundingClientRect()
  );
  let bestCandidate: { path: string; score: number } | null = null;

  for (const candidate of candidates) {
    const candidatePath = candidate.dataset.nodePath;
    if (!candidatePath || candidatePath === currentPath) {
      continue;
    }

    const candidateAnchor = navigationAnchor(
      candidatePath,
      candidate.getBoundingClientRect()
    );
    const primaryDistance = directionalDistance(
      currentAnchor,
      candidateAnchor,
      direction
    );
    if (primaryDistance <= 1) {
      continue;
    }

    const secondaryDistance = perpendicularDistance(
      currentAnchor,
      candidateAnchor,
      direction
    );
    const score = primaryDistance + secondaryDistance * 8;

    if (!bestCandidate || score < bestCandidate.score) {
      bestCandidate = { path: candidatePath, score };
    }
  }

  return bestCandidate?.path ?? currentPath;
}

function nodeElementsForPaths(
  workspace: HTMLElement,
  matchesPath: (path: string) => boolean
): HTMLElement[] {
  return Array.from(workspace.querySelectorAll<HTMLElement>("[data-node-path]")).filter(
    (element) => {
      const path = element.dataset.nodePath;
      return path ? matchesPath(path) : false;
    }
  );
}

function nodeSide(path: string): "left" | "right" | null {
  if (path.startsWith("left/")) {
    return "left";
  }

  if (path.startsWith("right/")) {
    return "right";
  }

  return null;
}

function isRootLevelPath(path: string, side: "left" | "right"): boolean {
  return path.startsWith(`${side}/`) && path.split("/").length === 2;
}

function isImmediateChildPath(path: string, parentPath: string): boolean {
  return (
    path.startsWith(`${parentPath}/`) &&
    path.split("/").length === parentPath.split("/").length + 1
  );
}

function parentPathFromNodePath(path: string): string {
  const parts = path.split("/");
  return parts.length <= 2 ? rootNodePath : parts.slice(0, -1).join("/");
}

function navigationAnchor(path: string, rect: DOMRect): { x: number; y: number } {
  if (path.startsWith("left/")) {
    return {
      x: rect.right,
      y: rect.top
    };
  }

  if (path.startsWith("right/")) {
    return {
      x: rect.left,
      y: rect.top
    };
  }

  return {
    x: rect.left + rect.width / 2,
    y: rect.top
  };
}

function directionalDistance(
  origin: { x: number; y: number },
  target: { x: number; y: number },
  direction: SpatialDirection
): number {
  if (direction === "left") {
    return origin.x - target.x;
  }

  if (direction === "right") {
    return target.x - origin.x;
  }

  if (direction === "up") {
    return origin.y - target.y;
  }

  return target.y - origin.y;
}

function perpendicularDistance(
  origin: { x: number; y: number },
  target: { x: number; y: number },
  direction: SpatialDirection
): number {
  return direction === "left" || direction === "right"
    ? Math.abs(target.y - origin.y)
    : Math.abs(target.x - origin.x);
}

function buildConnectorPaths(
  workspace: HTMLElement,
  mindmap: Mindmap,
  zoom: number,
  collapsedPaths: Set<string>
): ConnectorPath[] {
  const paths: ConnectorPath[] = [];
  const rootInput = nodeElement(workspace, rootNodePath);

  if (!rootInput) {
    return paths;
  }

  const addNodeConnectors = (parentPath: string, children: MindmapNode[]) => {
    const parentElement = nodeElement(workspace, parentPath);
    if (!parentElement) {
      return;
    }

    if (collapsedPaths.has(parentPath)) {
      return;
    }

    const childAnchors = children
      .map((child) => {
        const childElement = nodeElement(workspace, child.path);
        if (!childElement) {
          return null;
        }

        return {
          node: child,
          anchor: nodeAnchor(workspace, childElement, child.direction, "target", zoom)
        };
      })
      .filter((child): child is { node: MindmapNode; anchor: { x: number; y: number } } =>
        Boolean(child)
      );

    for (const direction of ["left", "right"] as const) {
      const directionalAnchors = childAnchors.filter(
        (child) => child.node.direction === direction
      );
      if (directionalAnchors.length === 0) {
        continue;
      }

      const source = nodeAnchor(workspace, parentElement, direction, "source", zoom);
      paths.push({
        id: `${parentPath}->${direction}-children`,
        d: connectorPathToChildren(
          source,
          directionalAnchors.map((child) => child.anchor),
          direction
        )
      });
    }

    for (const child of children) {
      addNodeConnectors(child.path, child.children);
    }
  };

  addNodeConnectors(rootNodePath, mindmap.children);
  return paths;
}

function nodeElement(workspace: HTMLElement, path: string): HTMLElement | null {
  return workspace.querySelector<HTMLElement>(
    `[data-node-path="${CSS.escape(path)}"]`
  );
}

function nodeAnchor(
  workspace: HTMLElement,
  element: HTMLElement,
  direction: Direction,
  role: "source" | "target",
  zoom: number
): { x: number; y: number } {
  const workspaceRect = workspace.getBoundingClientRect();
  const anchorElement = connectorAnchorElement(element, role);
  const rect = anchorElement.getBoundingClientRect();
  const scale = zoom || 1;
  const isRight = direction === "right";
  const anchorX =
    role === "source"
      ? isRight
        ? rect.right
        : rect.left
      : isRight
        ? rect.left
        : rect.right;

  return {
    x: (anchorX - workspaceRect.left) / scale,
    y: (rect.top + rect.height / 2 - workspaceRect.top) / scale
  };
}

function connectorAnchorElement(element: HTMLElement, role: "source" | "target"): HTMLElement {
  if (role === "target") {
    return element;
  }

  const row = element.closest<HTMLElement>(".node-row");
  return row ?? element;
}

function connectorPathToChildren(
  source: Point,
  targets: Point[],
  direction: Direction
): string {
  if (targets.length === 0) {
    return "";
  }

  if (targets.length === 1) {
    return connectorPathBetween(source, targets[0], direction);
  }

  const sortedTargets = [...targets].sort((left, right) => left.y - right.y);
  const trunkX = branchTrunkX(source, sortedTargets, direction);
  const minY = sortedTargets[0].y;
  const maxY = sortedTargets[sortedTargets.length - 1].y;
  const branchGap = Math.min(
    ...sortedTargets.map((target) => Math.abs(target.x - trunkX))
  );
  const cornerRadius = Math.min(18, Math.max(8, branchGap * 0.45));
  const parts = [
    curveSegment(source, { x: trunkX, y: source.y }, direction),
    `M ${roundPathNumber(trunkX)} ${roundPathNumber(minY + cornerRadius)}`,
    `L ${roundPathNumber(trunkX)} ${roundPathNumber(maxY - cornerRadius)}`
  ];

  for (const target of sortedTargets) {
    parts.push(branchPathFromTrunk(trunkX, target, direction, source.y, cornerRadius));
  }

  return parts.join(" ");
}

type Point = { x: number; y: number };

function connectorPathBetween(source: Point, target: Point, direction: Direction): string {
  return curveSegment(source, target, direction);
}

function curveSegment(source: Point, target: Point, direction: Direction): string {
  const distance = Math.max(Math.abs(target.x - source.x), 36);
  const handle = Math.min(140, Math.max(28, distance * 0.5));
  const sourceControlX = source.x + (direction === "right" ? handle : -handle);
  const targetControlX = target.x + (direction === "right" ? -handle : handle);

  return [
    `M ${roundPathNumber(source.x)} ${roundPathNumber(source.y)}`,
    `C ${roundPathNumber(sourceControlX)} ${roundPathNumber(source.y)}`,
    `${roundPathNumber(targetControlX)} ${roundPathNumber(target.y)}`,
    `${roundPathNumber(target.x)} ${roundPathNumber(target.y)}`
  ].join(" ");
}

function branchPathFromTrunk(
  trunkX: number,
  target: Point,
  direction: Direction,
  sourceY: number,
  cornerRadius: number
): string {
  const sign = direction === "right" ? 1 : -1;
  const verticalDelta = target.y - sourceY;
  const isCenterBranch = Math.abs(verticalDelta) <= cornerRadius;
  const startY = isCenterBranch
    ? target.y
    : target.y - Math.sign(verticalDelta) * cornerRadius;
  const elbowX = trunkX + sign * cornerRadius;
  const elbow = { x: elbowX, y: target.y };

  return [
    `M ${roundPathNumber(trunkX)} ${roundPathNumber(startY)}`,
    `C ${roundPathNumber(trunkX)} ${roundPathNumber((startY + target.y) / 2)}`,
    `${roundPathNumber((trunkX + elbowX) / 2)} ${roundPathNumber(target.y)}`,
    `${roundPathNumber(elbow.x)} ${roundPathNumber(elbow.y)}`,
    curveSegment(elbow, target, direction)
  ].join(" ");
}

function branchTrunkX(source: Point, targets: Point[], direction: Direction): number {
  const nearestTargetX =
    direction === "right"
      ? Math.min(...targets.map((target) => target.x))
      : Math.max(...targets.map((target) => target.x));
  const gap = Math.abs(nearestTargetX - source.x);
  const offset = Math.min(52, Math.max(24, gap * 0.55));
  return direction === "right" ? nearestTargetX - offset : nearestTargetX + offset;
}

function roundPathNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

function isInteractivePanTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, button, textarea, select, a, [role='button']") !== null
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
