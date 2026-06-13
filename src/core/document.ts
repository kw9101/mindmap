import type { Diagnostic } from "./diagnostics";
import { parseMindmap } from "./parser";

export type FileSnapshot = {
  path: string;
  name: string;
  contents: string;
  hash: string;
  mtimeMs: number;
  size: number;
};

export type OpenedFile = Omit<FileSnapshot, "contents">;

export type DocumentConflict = {
  disk: FileSnapshot;
  appSource: string;
};

export type ExternalError = {
  disk: FileSnapshot;
  diagnostics: Diagnostic[];
};

export type DocumentState = {
  source: string;
  savedSource: string;
  file: OpenedFile | null;
  dirty: boolean;
  saveStatus: "idle" | "pending" | "saving" | "error";
  saveError: string | null;
  conflict: DocumentConflict | null;
  externalError: ExternalError | null;
};

export type ExternalChangeResult =
  | { kind: "unchanged"; state: DocumentState }
  | { kind: "reloaded"; state: DocumentState }
  | { kind: "external-error"; state: DocumentState }
  | { kind: "conflict"; state: DocumentState };

export const defaultUntitledSource = `#
`;

export function createUntitledDocument(): DocumentState {
  return {
    source: defaultUntitledSource,
    savedSource: defaultUntitledSource,
    file: null,
    dirty: false,
    saveStatus: "idle",
    saveError: null,
    conflict: null,
    externalError: null
  };
}

export function openDocument(snapshot: FileSnapshot): DocumentState {
  return {
    source: snapshot.contents,
    savedSource: snapshot.contents,
    file: snapshotToOpenedFile(snapshot),
    dirty: false,
    saveStatus: "idle",
    saveError: null,
    conflict: null,
    externalError: null
  };
}

export function editDocument(state: DocumentState, nextSource: string): DocumentState {
  return {
    ...state,
    source: nextSource,
    dirty: state.file === null ? nextSource !== state.savedSource : nextSource !== state.savedSource,
    saveStatus: "pending",
    saveError: null,
    externalError: null
  };
}

export function markSaveStarted(state: DocumentState): DocumentState {
  return {
    ...state,
    saveStatus: "saving",
    saveError: null
  };
}

export function markSaved(state: DocumentState, snapshot: FileSnapshot): DocumentState {
  return {
    ...state,
    source: snapshot.contents,
    savedSource: snapshot.contents,
    file: snapshotToOpenedFile(snapshot),
    dirty: false,
    saveStatus: "idle",
    saveError: null,
    conflict: null,
    externalError: null
  };
}

export function markSaveFailed(state: DocumentState, message: string): DocumentState {
  return {
    ...state,
    saveStatus: "error",
    saveError: message
  };
}

export function applyExternalSnapshot(
  state: DocumentState,
  snapshot: FileSnapshot
): ExternalChangeResult {
  if (state.file?.hash === snapshot.hash) {
    return { kind: "unchanged", state };
  }

  if (state.dirty) {
    const next = {
      ...state,
      conflict: {
        disk: snapshot,
        appSource: state.source
      },
      externalError: null
    };
    return { kind: "conflict", state: next };
  }

  const parseResult = parseMindmap(snapshot.contents);
  if (!parseResult.ok) {
    const next = {
      ...state,
      externalError: {
        disk: snapshot,
        diagnostics: parseResult.diagnostics
      },
      conflict: null
    };
    return { kind: "external-error", state: next };
  }

  return {
    kind: "reloaded",
    state: openDocument(snapshot)
  };
}

export function chooseDiskVersion(state: DocumentState): DocumentState {
  if (!state.conflict) {
    return state;
  }

  return openDocument(state.conflict.disk);
}

export function chooseAppVersion(state: DocumentState): DocumentState {
  if (!state.conflict) {
    return state;
  }

  return {
    ...state,
    conflict: null,
    externalError: null,
    saveStatus: "pending",
    dirty: true
  };
}

export function clearExternalError(state: DocumentState): DocumentState {
  return {
    ...state,
    externalError: null
  };
}

function snapshotToOpenedFile(snapshot: FileSnapshot): OpenedFile {
  const { contents: _contents, ...file } = snapshot;
  return file;
}
