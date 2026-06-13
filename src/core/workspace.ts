export type WorkspaceDirectory = {
  path: string;
  name: string;
};

export type WorkspaceMarkdownFile = {
  path: string;
  name: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
};

export const workspaceDirectoryStorageKey = "mindmap_workspace_directory_v1";

export function parseWorkspaceDirectory(value: string | null): WorkspaceDirectory | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!isWorkspaceDirectoryLike(parsed)) {
      return null;
    }

    const path = parsed.path.trim();
    const name = parsed.name.trim();
    return path && name ? { path, name } : null;
  } catch {
    return null;
  }
}

export function serializeWorkspaceDirectory(directory: WorkspaceDirectory): string {
  return JSON.stringify({
    path: directory.path.trim(),
    name: directory.name.trim()
  });
}

export function workspaceDirectoryName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/u, "");
  const name = normalized.split(/[\\/]+/u).pop();
  return name && name.length > 0 ? name : path;
}

export function filterWorkspaceFiles(
  files: WorkspaceMarkdownFile[],
  query: string
): WorkspaceMarkdownFile[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);

  if (terms.length === 0) {
    return files;
  }

  return files.filter((file) => {
    const haystack = `${file.name} ${file.relativePath}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function isWorkspaceDirectoryLike(value: unknown): value is WorkspaceDirectory {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Partial<WorkspaceDirectory>;
  return typeof item.path === "string" && typeof item.name === "string";
}
