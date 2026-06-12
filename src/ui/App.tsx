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
import type { Direction, Mindmap, MindmapNode } from "../core/model";
import { parseClipboardNodes, serializeNodeForClipboard } from "../core/clipboard";
import { parseMindmap } from "../core/parser";
import { serializeMindmap } from "../core/serializer";
import {
  addChildNode,
  addPreviousSiblingNode,
  addRootNode,
  addSiblingNode,
  deleteNode,
  findNode,
  firstNodePath,
  insertSiblingNodes,
  isRootNodePath,
  moveNodeDown,
  moveNodeUp,
  nextSiblingNodePath,
  parentNodePath,
  previousNodePath,
  previousSiblingNodePath,
  rootNodePath,
  updateNodeText,
  updateRootTitle
} from "../core/tree";
import {
  createDefaultViewState,
  formatZoom,
  panBy,
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
  readMarkdownFile,
  unwatchMarkdownFile,
  watchMarkdownFile,
  writeAppState,
  writeMarkdownFileAtomic,
  type DiffFiles
} from "../platform/native";
import { getNodeEditingShortcut, isImeComposing } from "./keyboard";
import { getNodeInputWidth, getRootInputWidth } from "./nodeSizing";

const autosaveDelayMs = 700;
const externalPollMs = 2500;

type ConnectorPath = {
  id: string;
  d: string;
};

type KeyboardShortcutGroup = {
  title: string;
  shortcuts: { keys: string; action: string }[];
};

type FocusedNodeTarget = {
  path: string;
  editing: boolean;
};

type SpatialDirection = "up" | "down" | "left" | "right";

const keyboardShortcutGroups: KeyboardShortcutGroup[] = [
  {
    title: "편집 중",
    shortcuts: [
      { keys: "Enter", action: "다음 형제로 이동 또는 생성" },
      { keys: "Shift+Enter", action: "위 형제로 이동 또는 생성" },
      { keys: "Tab", action: "첫 자식으로 이동 또는 생성" },
      { keys: "Shift+Tab", action: "부모 노드 편집" },
      { keys: "Esc", action: "선택 모드로 전환" },
      { keys: "Option/Cmd+ArrowUp", action: "위로 이동" },
      { keys: "Option/Cmd+ArrowDown", action: "아래로 이동" },
      { keys: "Option/Cmd+Backspace", action: "노드 삭제" }
    ]
  },
  {
    title: "선택 모드",
    shortcuts: [
      { keys: "ArrowUp/Down", action: "화면상 위/아래 노드 선택" },
      { keys: "ArrowLeft/Right", action: "화면상 왼쪽/오른쪽 노드 선택" },
      { keys: "Enter", action: "편집 시작" },
      { keys: "Backspace/Delete", action: "노드 삭제" },
      { keys: "Cmd/Ctrl+C", action: "선택 subtree 복사" },
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
      { keys: "Cmd/Ctrl++", action: "확대" },
      { keys: "Cmd/Ctrl+-", action: "축소" },
      { keys: "Cmd/Ctrl+0", action: "100%" },
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
  const [isPanning, setIsPanning] = useState(false);
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPath[]>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pan: MindmapViewState["pan"];
  } | null>(null);

  const activeDocument = history.present.value;
  const parseResult = useMemo(
    () => parseMindmap(activeDocument.source),
    [activeDocument.source]
  );
  const mindmap = parseResult.ok ? parseResult.mindmap : null;
  const nativeAvailable = isNativeAvailable();
  const fileName = activeDocument.file?.name ?? "untitled.md";
  const status = statusLabel(activeDocument, nativeAvailable);
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
        setNotice(`내부 편집 결과가 파싱되지 않았습니다: ${nextResult.diagnostics[0].code}`);
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
      editingNodePath: editing ? path : null
    }));
  }, []);

  const exitEditingIfCurrent = useCallback((path: string) => {
    setViewState((current) =>
      current.editingNodePath === path
        ? {
            ...current,
            selectedNodePath: path,
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
        setNotice(`저장 전에 Markdown 파싱이 실패했습니다: ${validation.diagnostics[0].code}`);
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

  const handleCopySubtree = useCallback(async () => {
    if (!mindmap || !selectedDocumentNode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(serializeNodeForClipboard(selectedDocumentNode));
      setNotice("선택한 노드를 Markdown 목록으로 복사했습니다.");
    } catch (error) {
      setNotice(`클립보드에 쓸 수 없습니다: ${errorMessage(error)}`);
    }
  }, [mindmap, selectedDocumentNode]);

  const handlePasteSubtree = useCallback(async () => {
    if (!mindmap || !selectedDocumentNode) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseClipboardNodes(text, selectedDocumentNode.direction);
      if (!parsed.ok) {
        setNotice(`붙여넣기 Markdown을 읽을 수 없습니다: ${parsed.diagnostics[0].code}`);
        return;
      }

      const next = insertSiblingNodes(mindmap, selectedDocumentNode.path, parsed.nodes);
      commitMindmap(next, "Paste nodes", nextSiblingNodePath(next, selectedDocumentNode.path));
    } catch (error) {
      setNotice(`클립보드에서 읽을 수 없습니다: ${errorMessage(error)}`);
    }
  }, [commitMindmap, mindmap, selectedDocumentNode]);

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

    if (
      isRootNodePath(viewState.selectedNodePath) ||
      (viewState.selectedNodePath && findNode(mindmap, viewState.selectedNodePath))
    ) {
      return;
    }

    setViewState((current) => ({
      ...current,
      selectedNodePath: firstNodePath(mindmap),
      editingNodePath: firstNodePath(mindmap) || null
    }));
  }, [mindmap, viewState.selectedNodePath]);

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

      setConnectorPaths(buildConnectorPaths(workspace, mindmap, viewState.zoom));
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
  }, [mindmap, viewState.zoom]);

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

      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowKeyboardHelp(true);
      } else if (!editing && (event.key === "?" || (event.shiftKey && event.key === "/"))) {
        event.preventDefault();
        setShowKeyboardHelp(true);
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
      } else if (!editing && (event.metaKey || event.ctrlKey) && key === "v") {
        event.preventDefault();
        void handlePasteSubtree();
      } else if (!editing && mindmap && viewState.selectedNodePath) {
        const spatialDirection = spatialDirectionForKey(event.key);
        if (spatialDirection) {
          event.preventDefault();
          selectNode(
            spatialNodePath(workspaceRef.current, viewState.selectedNodePath, spatialDirection),
            false
          );
        } else if (event.key === "Enter") {
          event.preventDefault();
          selectNode(viewState.selectedNodePath, true);
        } else if (event.key === "Backspace" || event.key === "Delete") {
          if (isRootNodePath(viewState.selectedNodePath)) {
            event.preventDefault();
            return;
          }

          event.preventDefault();
          const fallback = previousNodePath(mindmap, viewState.selectedNodePath);
          const next = deleteNode(mindmap, viewState.selectedNodePath);
          commitMindmap(
            next,
            "Delete node",
            findNode(next, fallback) ? fallback : firstNodePath(next)
          );
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commitMindmap,
    handleCopySubtree,
    handleOpen,
    handlePasteSubtree,
    handleRedo,
    handleResetZoom,
    handleSave,
    handleUndo,
    handleZoomIn,
    handleZoomOut,
    mindmap,
    selectNode,
    showKeyboardHelp,
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
  const renderNodeEditor = (node: MindmapNode, side: Direction) => (
    <NodeEditor
      key={node.path}
      node={node}
      side={side}
      selectedPath={viewState.selectedNodePath}
      editingPath={viewState.editingNodePath}
      onSelect={(path, editing) => selectNode(path, editing)}
      onExitEditing={exitEditingIfCurrent}
      onTextChange={(path, text) => {
        commitMindmap(updateNodeText(mindmap!, path, text), "Edit node text", path);
      }}
      onFocusChildOrCreate={(path) => {
        const childPath = firstChildPathForExistingNode(mindmap!, path);
        if (childPath) {
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
      onMoveUp={(path) => {
        const next = moveNodeUp(mindmap!, path);
        commitMindmap(next, "Move node up", remapPathAfterTextMatch(next, path));
      }}
      onMoveDown={(path) => {
        const next = moveNodeDown(mindmap!, path);
        commitMindmap(next, "Move node down", remapPathAfterTextMatch(next, path));
      }}
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
          <button type="button" onClick={handleUndo} disabled={!canUndo(history)}>
            Undo
          </button>
          <button type="button" onClick={handleRedo} disabled={!canRedo(history)}>
            Redo
          </button>
          <button
            type="button"
            onClick={handleCopySubtree}
            disabled={!mindmap || !selectedDocumentNode}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handlePasteSubtree}
            disabled={!mindmap || !selectedDocumentNode}
          >
            Paste
          </button>
          <button
            type="button"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setShowKeyboardHelp(true)}
          >
            ?
          </button>
          {mindmap && (
            <>
              <button
                type="button"
                aria-label="Add right root node"
                title="Add right root node"
                onClick={() => {
                  const next = addRootNode(mindmap, "right");
                  commitMindmap(next, "Add right root node", lastRootPath(next, "right"));
                }}
              >
                +R
              </button>
              <button
                type="button"
                aria-label="Add left root node"
                title="Add left root node"
                onClick={() => {
                  const next = addRootNode(mindmap, "left");
                  commitMindmap(next, "Add left root node", lastRootPath(next, "left"));
                }}
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
            <button
              type="button"
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
            className={`workspace-viewport${isPanning ? " is-panning" : ""}`}
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
                  className={viewState.selectedNodePath === rootNodePath ? "selected" : ""}
                  path={rootNodePath}
                  value={mindmap!.title}
                  width={getRootInputWidth(mindmap!.title)}
                  ariaLabel="Root heading"
                  readOnly={!rootEditing}
                  editOnClick={viewState.selectedNodePath === rootNodePath && !rootEditing}
                  onFocus={() => selectNode(rootNodePath, rootEditing)}
                  onEditClick={() => selectNode(rootNodePath, true)}
                  onChange={(text) =>
                    commitMindmap(updateRootTitle(mindmap!, text), "Edit root heading")
                  }
                  onBlur={() => exitEditingIfCurrent(rootNodePath)}
                  onKeyDown={(event) => {
                    if (!rootEditing) {
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
  onChange,
  onBlur,
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
  onChange: (text: string) => void;
  onBlur: (nextFocusedNode: FocusedNodeTarget | null) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOnClickRef = useRef(false);

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
      onMouseDown={() => {
        editOnClickRef.current = editOnClick;
      }}
      onClick={() => {
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

function NodeEditor({
  node,
  side,
  selectedPath,
  editingPath,
  onSelect,
  onExitEditing,
  onTextChange,
  onFocusChildOrCreate,
  onFocusNextOrCreate,
  onDelete,
  onDeleteEmpty,
  onFocusPrevious,
  onFocusParent,
  onMoveUp,
  onMoveDown
}: {
  node: MindmapNode;
  side: Direction;
  selectedPath: string;
  editingPath: string | null;
  onSelect: (path: string, editing: boolean) => void;
  onExitEditing: (path: string) => void;
  onTextChange: (path: string, text: string) => void;
  onFocusChildOrCreate: (path: string) => void;
  onFocusNextOrCreate: (path: string) => void;
  onDelete: (path: string) => void;
  onDeleteEmpty: (path: string, nextFocusedNode?: FocusedNodeTarget | null) => void;
  onFocusPrevious: (path: string) => void;
  onFocusParent: (path: string) => void;
  onMoveUp: (path: string) => void;
  onMoveDown: (path: string) => void;
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
            editingPath={editingPath}
            onSelect={onSelect}
            onExitEditing={onExitEditing}
            onTextChange={onTextChange}
            onFocusChildOrCreate={onFocusChildOrCreate}
            onFocusNextOrCreate={onFocusNextOrCreate}
            onDelete={onDelete}
            onDeleteEmpty={onDeleteEmpty}
            onFocusPrevious={onFocusPrevious}
            onFocusParent={onFocusParent}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        ))}
      </div>
    ) : null;

  const selected = selectedPath === node.path;
  const editing = editingPath === node.path;

  return (
    <div className={`node-subtree ${side}`}>
      {side === "left" && children}
      <div className="node-row">
        <NodeTextArea
          className={`node-input${selected ? " selected" : ""}`}
          path={node.path}
          value={node.text}
          width={getNodeInputWidth(node.text)}
          ariaLabel={`Node ${node.path}`}
          readOnly={!editing}
          editOnClick={selected && !editing}
          onFocus={() => onSelect(node.path, editing)}
          onEditClick={() => onSelect(node.path, true)}
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
            } else if (shortcut === "add-child") {
              onFocusChildOrCreate(node.path);
            } else if (shortcut === "exit-editing") {
              event.currentTarget.blur();
            } else if (shortcut === "focus-previous") {
              onFocusPrevious(node.path);
            } else if (shortcut === "focus-parent") {
              onFocusParent(node.path);
            } else if (shortcut === "move-up") {
              onMoveUp(node.path);
            } else if (shortcut === "move-down") {
              onMoveDown(node.path);
            } else if (shortcut === "delete") {
              onDelete(node.path);
            }
          }}
        />
      </div>
      {side === "right" && children}
    </div>
  );
}

function toSingleLineNodeText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ");
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

function remapPathAfterTextMatch(mindmap: Mindmap, previousPath: string): string {
  if (findNode(mindmap, previousPath)) {
    return previousPath;
  }

  return firstNodePath(mindmap);
}

function selectionPathAfterDelete(mindmap: Mindmap, fallbackPath: string): string {
  if (isRootNodePath(fallbackPath)) {
    return rootNodePath;
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
  zoom: number
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
  const rect = element.getBoundingClientRect();
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
