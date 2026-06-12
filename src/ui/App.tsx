import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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
  addRootNode,
  addSiblingNode,
  deleteNode,
  findNode,
  firstChildNodePath,
  firstNodePath,
  indentNode,
  insertSiblingNodes,
  isRootNodePath,
  moveNodeDown,
  moveNodeUp,
  nextNodePath,
  outdentNode,
  parentNodePath,
  previousNodePath,
  rootNodePath,
  updateNodeText,
  updateRootTitle
} from "../core/tree";
import {
  createDefaultViewState,
  formatZoom,
  parseViewState,
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

export function App() {
  const [history, setHistory] = useState<HistoryState<DocumentState>>(() =>
    createHistory(createUntitledDocument())
  );
  const [viewState, setViewState] = useState<MindmapViewState>(() =>
    createDefaultViewState()
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFiles | null>(null);

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
    (nextMindmap: Mindmap, label: string, nextSelectedPath?: string) => {
      commitSource(serializeMindmap(nextMindmap), label);
      if (nextSelectedPath !== undefined) {
        setViewState((current) => ({
          ...current,
          selectedNodePath: nextSelectedPath,
          editingNodePath: nextSelectedPath || null
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
      commitMindmap(next, "Paste nodes", nextNodePath(next, selectedDocumentNode.path));
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

    const input = globalThis.document?.querySelector<HTMLInputElement>(
      `input[data-node-path="${CSS.escape(viewState.editingNodePath)}"]`
    );
    input?.focus();
  }, [viewState.editingNodePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) {
        return;
      }

      const key = event.key.toLowerCase();
      const editing = viewState.editingNodePath !== null;
      if ((event.metaKey || event.ctrlKey) && key === "s") {
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
        if (event.key === "ArrowUp") {
          event.preventDefault();
          selectNode(previousNodePath(mindmap, viewState.selectedNodePath), false);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          selectNode(nextNodePath(mindmap, viewState.selectedNodePath), false);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          selectNode(parentNodePath(mindmap, viewState.selectedNodePath), false);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          selectNode(firstChildNodePath(mindmap, viewState.selectedNodePath), false);
        } else if (event.key === "Enter" || event.key === " " || event.key === "F2") {
          event.preventDefault();
          selectNode(viewState.selectedNodePath, true);
        } else if (event.key === "Tab") {
          if (isRootNodePath(viewState.selectedNodePath)) {
            event.preventDefault();
            return;
          }

          event.preventDefault();
          const next = event.shiftKey
            ? outdentNode(mindmap, viewState.selectedNodePath)
            : indentNode(mindmap, viewState.selectedNodePath);
          commitMindmap(
            next,
            event.shiftKey ? "Outdent node" : "Indent node",
            remapPathAfterTextMatch(next, viewState.selectedNodePath)
          );
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
    viewState.editingNodePath,
    viewState.selectedNodePath
  ]);

  const rightNodes = mindmap?.children.filter((node) => node.direction === "right") ?? [];
  const leftNodes = mindmap?.children.filter((node) => node.direction === "left") ?? [];
  const workspaceStyle = {
    "--workspace-zoom": String(viewState.zoom)
  } as CSSProperties;
  const renderNodeEditor = (node: MindmapNode, side: Direction) => (
    <NodeEditor
      key={node.path}
      node={node}
      side={side}
      selectedPath={viewState.selectedNodePath}
      onSelect={(path) => selectNode(path, true)}
      onExitEditing={(path) => selectNode(path, false)}
      onTextChange={(path, text) => {
        commitMindmap(updateNodeText(mindmap!, path, text), "Edit node text", path);
      }}
      onAddChild={(path) => {
        const next = addChildNode(mindmap!, path);
        commitMindmap(next, "Add child node", lastChildPath(next, path));
      }}
      onAddSibling={(path) => {
        const next = addSiblingNode(mindmap!, path);
        commitMindmap(next, "Add sibling node", nextNodePath(next, path));
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
      onOutdent={(path) => {
        const next = outdentNode(mindmap!, path);
        commitMindmap(next, "Outdent node", remapPathAfterTextMatch(next, path));
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
          </div>
        </div>
      </header>

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
          <section className="workspace-viewport">
            <section
              className={`workspace${leftNodes.length > 0 ? " has-left" : ""}${
                rightNodes.length > 0 ? " has-right" : ""
              }`}
              style={workspaceStyle}
            >
              <aside className="branch branch-left" aria-label="Left branch">
                {leftNodes.length > 0 && (
                  <div className="root-child-column">
                    {leftNodes.map((node) => renderNodeEditor(node, "left"))}
                  </div>
                )}
              </aside>

              <section className="root-node" aria-label="Root node">
                <input
                  className={viewState.selectedNodePath === rootNodePath ? "selected" : ""}
                  data-node-path={rootNodePath}
                  value={mindmap!.title}
                  style={{ width: getRootInputWidth(mindmap!.title) }}
                  aria-label="Root heading"
                  onFocus={() => selectNode(rootNodePath, true)}
                  onChange={(event) =>
                    commitMindmap(
                      updateRootTitle(mindmap!, event.target.value),
                      "Edit root heading"
                    )
                  }
                  onKeyDown={(event) => {
                    if (isImeComposing(event)) {
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

function NodeEditor({
  node,
  side,
  selectedPath,
  onSelect,
  onExitEditing,
  onTextChange,
  onAddChild,
  onAddSibling,
  onDelete,
  onOutdent,
  onMoveUp,
  onMoveDown
}: {
  node: MindmapNode;
  side: Direction;
  selectedPath: string;
  onSelect: (path: string) => void;
  onExitEditing: (path: string) => void;
  onTextChange: (path: string, text: string) => void;
  onAddChild: (path: string) => void;
  onAddSibling: (path: string) => void;
  onDelete: (path: string) => void;
  onOutdent: (path: string) => void;
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
            onSelect={onSelect}
            onExitEditing={onExitEditing}
            onTextChange={onTextChange}
            onAddChild={onAddChild}
            onAddSibling={onAddSibling}
            onDelete={onDelete}
            onOutdent={onOutdent}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        ))}
      </div>
    ) : null;

  const selected = selectedPath === node.path;

  return (
    <div className={`node-subtree ${side}`}>
      {side === "left" && children}
      <div className="node-row">
        <input
          className={`node-input${selected ? " selected" : ""}`}
          data-node-path={node.path}
          value={node.text}
          style={{ width: getNodeInputWidth(node.text) }}
          aria-label={`Node ${node.path}`}
          onFocus={() => onSelect(node.path)}
          onChange={(event) => onTextChange(node.path, event.target.value)}
          onKeyDown={(event) => {
            const shortcut = getNodeEditingShortcut(event);
            if (!shortcut) {
              return;
            }

            event.preventDefault();

            if (shortcut === "add-sibling") {
              onAddSibling(node.path);
            } else if (shortcut === "add-child") {
              onAddChild(node.path);
            } else if (shortcut === "exit-editing") {
              onExitEditing(node.path);
              event.currentTarget.blur();
            } else if (shortcut === "outdent") {
              onOutdent(node.path);
            } else if (shortcut === "move-up") {
              onMoveUp(node.path);
            } else if (shortcut === "move-down") {
              onMoveDown(node.path);
            } else if (shortcut === "delete") {
              onDelete(node.path);
            }
          }}
        />
        <div className="node-actions">
          <button
            type="button"
            aria-label="Add child node"
            title="Add child node"
            onClick={() => onAddChild(node.path)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Add sibling node"
            title="Add sibling node"
            onClick={() => onAddSibling(node.path)}
          >
            S
          </button>
          <button
            type="button"
            aria-label="Delete node"
            title="Delete node"
            onClick={() => onDelete(node.path)}
          >
            Del
          </button>
        </div>
      </div>
      {side === "right" && children}
    </div>
  );
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

function remapPathAfterTextMatch(mindmap: Mindmap, previousPath: string): string {
  if (findNode(mindmap, previousPath)) {
    return previousPath;
  }

  return firstNodePath(mindmap);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
