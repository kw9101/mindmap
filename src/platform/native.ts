import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileSnapshot } from "../core/document";
import type { WorkspaceMarkdownFile } from "../core/workspace";

export type FileMetadata = Omit<FileSnapshot, "contents">;

export type DiffFiles = {
  appPath: string;
  diskPath: string;
};

export type OpenDiffResult = {
  files: DiffFiles;
  launched: boolean;
  message: string;
};

export type MarkdownFileChangedEvent = {
  path: string;
  kind: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isNativeAvailable(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

export async function pickOpenMarkdownPath(): Promise<string | null> {
  if (!isNativeAvailable()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
  });

  return typeof selected === "string" ? selected : null;
}

export async function pickSaveMarkdownPath(defaultPath?: string): Promise<string | null> {
  if (!isNativeAvailable()) {
    return null;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
  });
}

export async function pickWorkspaceDirectoryPath(): Promise<string | null> {
  if (!isNativeAvailable()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false
  });

  return typeof selected === "string" ? selected : null;
}

export async function readMarkdownFile(path: string): Promise<FileSnapshot> {
  return invoke<FileSnapshot>("read_markdown_file", { path });
}

export async function readMarkdownMetadata(path: string): Promise<FileMetadata> {
  return invoke<FileMetadata>("read_markdown_metadata", { path });
}

export async function writeMarkdownFileAtomic(
  path: string,
  contents: string
): Promise<FileSnapshot> {
  return invoke<FileSnapshot>("write_markdown_file_atomic", { path, contents });
}

export async function listWorkspaceMarkdownFiles(
  directoryPath: string
): Promise<WorkspaceMarkdownFile[]> {
  return invoke<WorkspaceMarkdownFile[]>("list_workspace_markdown_files", {
    directoryPath
  });
}

export async function createWorkspaceMarkdownFile(
  directoryPath: string,
  fileName: string,
  contents: string
): Promise<FileSnapshot> {
  return invoke<FileSnapshot>("create_workspace_markdown_file", {
    directoryPath,
    fileName,
    contents
  });
}

export async function readAppState(
  documentPath: string,
  key: string
): Promise<string | null> {
  return invoke<string | null>("read_app_state", { documentPath, key });
}

export async function writeAppState(
  documentPath: string,
  key: string,
  value: string
): Promise<void> {
  await invoke("write_app_state", { documentPath, key, value });
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isNativeAvailable()) {
    await invoke("write_clipboard_text", { text });
    return;
  }

  const clipboard = browserClipboard();
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }

  if (writeClipboardTextWithSelection(text)) {
    return;
  }

  throw new Error("이 실행 환경에서는 클립보드 쓰기를 사용할 수 없습니다.");
}

export async function readClipboardText(): Promise<string> {
  if (isNativeAvailable()) {
    return invoke<string>("read_clipboard_text");
  }

  const clipboard = browserClipboard();
  if (clipboard?.readText) {
    return clipboard.readText();
  }

  throw new Error("이 실행 환경에서는 클립보드 읽기를 사용할 수 없습니다.");
}

export async function getSidecarPath(documentPath: string): Promise<string> {
  return invoke<string>("sidecar_path", { documentPath });
}

export async function prepareExternalDiffFiles(
  documentPath: string,
  appSource: string,
  diskSource: string
): Promise<DiffFiles> {
  return invoke<DiffFiles>("prepare_external_diff_files", {
    documentPath,
    appSource,
    diskSource
  });
}

export async function openExternalDiff(
  documentPath: string,
  appSource: string,
  diskSource: string,
  diffCommand?: string
): Promise<OpenDiffResult> {
  return invoke<OpenDiffResult>("open_external_diff", {
    documentPath,
    appSource,
    diskSource,
    diffCommand
  });
}

export async function watchMarkdownFile(path: string): Promise<void> {
  await invoke("watch_markdown_file", { path });
}

export async function unwatchMarkdownFile(path: string): Promise<void> {
  await invoke("unwatch_markdown_file", { path });
}

export async function listenMarkdownFileChanged(
  handler: (event: MarkdownFileChangedEvent) => void
): Promise<UnlistenFn> {
  return listen<MarkdownFileChangedEvent>("markdown-file-changed", (event) => {
    handler(event.payload);
  });
}

type BrowserClipboard = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

function browserClipboard(): BrowserClipboard | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return navigator.clipboard as BrowserClipboard | undefined;
}

function writeClipboardTextWithSelection(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);

  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  textArea.focus();
  textArea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
    previousFocus?.focus();
  }
}
